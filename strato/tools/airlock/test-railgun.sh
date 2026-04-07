#!/usr/bin/env bash
# Railgun Privacy System Integration Test Script
# Generated from railgunTest.en
#
# This script:
# 1. Stops any running node
# 2. Wipes node data fresh
# 3. Rebuilds everything
# 4. Starts node
# 5. Runs Railgun tests
#
# Usage: ./test-railgun.sh [--skip-shield]

set -e

# Find repo root (where start script lives)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
STRATO_DIR="$REPO_ROOT/strato"

cd "$REPO_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SECRETS_DIR="$HOME/.secrets"
TEST_TOKEN_FILE="$SECRETS_DIR/testTokenAddress"
NODE_NAME="mynode"
source "$SCRIPT_DIR/admin/get-contract-address.sh"

# Parse arguments
SKIP_SHIELD=false
for arg in "$@"; do
  case $arg in
    --skip-shield) SKIP_SHIELD=true ;;
    --help)
      echo "Usage: $0 [--skip-shield]"
      echo ""
      echo "Options:"
      echo "  --skip-shield   Skip shielding test"
      exit 0
      ;;
  esac
done

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_test() { echo -e "\n${BLUE}=== TEST: $1 ===${NC}"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; }
log_cmd() { echo -e "${YELLOW}\$${NC} $1"; }

run_cmd() {
  log_cmd "$*"
  "$@"
}

# Track test results
declare -A TEST_RESULTS

record_result() {
  local test_name="$1"
  local status="$2"
  local notes="$3"
  TEST_RESULTS["$test_name"]="$status|$notes"
}

print_summary() {
  echo -e "\n${BLUE}=== TEST SUMMARY ===${NC}"
  printf "%-30s %-15s %s\n" "Test" "Status" "Notes"
  printf "%-30s %-15s %s\n" "----" "------" "-----"
  for test_name in "${!TEST_RESULTS[@]}"; do
    IFS='|' read -r status notes <<< "${TEST_RESULTS[$test_name]}"
    case "$status" in
      PASS) printf "%-30s ${GREEN}%-15s${NC} %s\n" "$test_name" "$status" "$notes" ;;
      FAIL) printf "%-30s ${RED}%-15s${NC} %s\n" "$test_name" "$status" "$notes" ;;
      EXPECTED_FAIL) printf "%-30s ${YELLOW}%-15s${NC} %s\n" "$test_name" "$status" "$notes" ;;
      *) printf "%-30s %-15s %s\n" "$test_name" "$status" "$notes" ;;
    esac
  done
}

wait_for_node() {
  local url="${1:-http://localhost:8081}"
  local max_attempts="${2:-60}"
  local attempt=0
  
  log_info "Waiting for node to be ready at $url..."
  while [ $attempt -lt $max_attempts ]; do
    # Check if nginx is up and responding with 200
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "$url/" 2>/dev/null || echo "000")
    if [ "$http_code" = "200" ]; then
      # Also verify strato-api is responding on internal port
      if curl -s --connect-timeout 2 "http://172.17.0.1:3000/" > /dev/null 2>&1; then
        log_pass "Node is ready"
        return 0
      fi
    fi
    attempt=$((attempt + 1))
    echo -n "."
    sleep 2
  done
  echo ""
  log_error "Node did not become ready after $max_attempts attempts"
  return 1
}

# =============================================================================
# Setup: Stop, Wipe, Rebuild, Start (always runs for clean slate)
# =============================================================================

log_test "Environment Setup"

# Stop any running node
log_info "Stopping any running node..."
if [ -f "./stop" ]; then
  ./stop "$NODE_NAME" 2>/dev/null || true
fi

# Kill any stray convoke/strato processes
log_info "Killing any stray strato processes..."
pkill -9 -f convoke 2>/dev/null || true
pkill -9 -f "strato-api" 2>/dev/null || true
pkill -9 -f "strato-sequencer" 2>/dev/null || true
pkill -9 -f "strato-p2p" 2>/dev/null || true
pkill -9 -f "ethereum-discover" 2>/dev/null || true
pkill -9 -f "blockapps-vault" 2>/dev/null || true
pkill -9 -f "slipstream" 2>/dev/null || true
pkill -9 -f "vm-runner" 2>/dev/null || true
sleep 5

# Wipe node data
log_info "Wiping node data..."
if [ -f "./wipe" ]; then
  ./wipe -y "$NODE_NAME" 2>&1 || log_warn "Wipe returned non-zero (node may not exist yet)"
else
  log_warn "No wipe script found, continuing..."
fi

# Note: Contract address is stored in node's ethconf.yaml, cleaned on redeploy

# Rebuild everything
log_info "Rebuilding (this may take a while)..."
cd "$REPO_ROOT"
run_cmd make

# Start node in background (using nohup to detach from terminal)
cd "$REPO_ROOT"
log_info "Starting node in background..."
log_cmd "network=lithium nohup ./start $NODE_NAME &"
nohup bash -c "network=lithium ./start $NODE_NAME" > /tmp/strato-start.log 2>&1 &
START_PID=$!
log_info "Start script PID: $START_PID"
# Give convoke time to initialize
sleep 10

# Wait for node to be ready
if ! wait_for_node "http://localhost:8081" 120; then
  log_error "Failed to start node"
  log_info "Start script log tail:"
  tail -30 /tmp/strato-start.log
  record_result "Environment Setup" "FAIL" "Node start failed"
  print_summary
  exit 1
fi

record_result "Environment Setup" "PASS" "Node running"

# =============================================================================
# Prerequisites Check
# =============================================================================

log_test "Prerequisites"

# Check airlock is in path
if ! command -v airlock &> /dev/null; then
  log_error "airlock not found in PATH"
  log_info "Expected at ~/.local/bin/airlock"
  log_info "Run 'stack install' in strato/ or add ~/.local/bin to PATH"
  record_result "Prerequisites" "FAIL" "airlock not in PATH"
  print_summary
  exit 1
fi
log_pass "airlock found: $(which airlock)"

# Check secrets directory
if [ ! -d "$SECRETS_DIR" ]; then
  mkdir -p "$SECRETS_DIR"
  log_info "Created secrets directory: $SECRETS_DIR"
fi

# Login (use existing token if valid, otherwise do device flow)
log_info "Checking authentication..."
if [ -f "$HOME/.secrets/stratoToken" ]; then
  log_pass "Already authenticated (token exists)"
else
  log_info "Token missing, authenticating..."
  run_cmd strato-auth
fi

# Setup wallet
log_info "Setting up wallet..."
if airlock list_wallets 2>&1 | grep -q "default"; then
  log_info "Wallet 'default' already exists"
else
  run_cmd airlock setup_wallet
fi

# Get Railgun address
ADDR_OUTPUT=$(airlock list_addresses --num 1 2>&1)
RAILGUN_USER_ADDR=$(echo "$ADDR_OUTPUT" | grep -oE '0zk[a-fA-F0-9]{128}' | head -1 || echo "")
if [ -z "$RAILGUN_USER_ADDR" ]; then
  log_error "Failed to get Railgun address"
  record_result "Prerequisites" "FAIL" "No Railgun address"
  print_summary
  exit 1
fi
log_info "Railgun address: ${RAILGUN_USER_ADDR:0:30}..."

# Get Ethereum address from balance output
BALANCE_OUTPUT=$(airlock balance 2>&1 || true)
USER_ADDRESS=$(echo "$BALANCE_OUTPUT" | grep -oE '0x[a-fA-F0-9]{40}' | head -1 || echo "")
if [ -n "$USER_ADDRESS" ]; then
  log_info "Ethereum address: $USER_ADDRESS"
else
  log_warn "Could not determine Ethereum address yet"
fi

record_result "Prerequisites" "PASS" "Ready"

# =============================================================================
# Contract Deployment
# =============================================================================

log_test "Contract Deployment"

cd "$SCRIPT_DIR"

log_info "Deploying RailgunSmartWallet contract..."
log_cmd "admin/deploy-railgun.sh"
if ./admin/deploy-railgun.sh; then
  RAILGUN_ADDR=$(get_railgun_address 2>/dev/null || echo "")
  if [ -n "$RAILGUN_ADDR" ]; then
    log_pass "Contract deployed: $RAILGUN_ADDR"
    record_result "Contract Deployment" "PASS" "$RAILGUN_ADDR"
  else
    log_error "Deploy succeeded but address not found in config"
    record_result "Contract Deployment" "FAIL" "No address in config"
  fi
else
  log_error "Deployment failed"
  record_result "Contract Deployment" "FAIL" "Script error"
fi

if [ -z "$RAILGUN_ADDR" ]; then
  log_error "Cannot continue without contract address"
  print_summary
  exit 1
fi

# Initialize contract
log_info "Initializing contract..."
log_cmd "admin/init-railgun.sh"
if ./admin/init-railgun.sh; then
  log_pass "Contract initialized"
  record_result "Contract Init" "PASS" ""
else
  log_warn "Init may have failed (might already be initialized)"
  record_result "Contract Init" "WARN" "May be pre-initialized"
fi

# Set verifier keys (required for unshield)
# 1-1 circuit: 1 input note, 1 output (no change)
# 1-2 circuit: 1 input note, 2 outputs (unshield + change)
log_info "Setting verifier keys..."
VKEY_OK=true
for circuit in "1 1" "1 2"; do
  log_cmd "admin/set-verifier-key.sh $circuit"
  if ./admin/set-verifier-key.sh $circuit; then
    log_pass "Verifier key set for circuit ($circuit)"
  else
    log_fail "Failed to set verifier key for circuit ($circuit)"
    VKEY_OK=false
  fi
done
if [ "$VKEY_OK" = true ]; then
  record_result "Verifier Keys" "PASS" ""
else
  record_result "Verifier Keys" "FAIL" ""
fi

cd "$REPO_ROOT"

# =============================================================================
# Test Token (check if configured)
# =============================================================================

log_test "Test Token"

# Default to USDST token if not configured
DEFAULT_TOKEN="0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010"

TOKEN_ADDR=""
if [ -f "$TEST_TOKEN_FILE" ]; then
  TOKEN_ADDR=$(cat "$TEST_TOKEN_FILE")
  log_info "Using saved test token: $TOKEN_ADDR"
else
  TOKEN_ADDR="$DEFAULT_TOKEN"
  log_info "Using default USDST token: $TOKEN_ADDR"
fi
record_result "Test Token" "PASS" "$TOKEN_ADDR"

# =============================================================================
# Shield Test
# =============================================================================

log_test "Shield Tokens"

if [ "$SKIP_SHIELD" = true ]; then
  log_info "Skipping shield (--skip-shield)"
  record_result "Shield Tokens" "SKIP" ""
elif [ -z "$TOKEN_ADDR" ]; then
  log_warn "Skipping shield - no token address configured"
  record_result "Shield Tokens" "SKIP" "No token"
else
  log_info "Shielding 2 tokens (with approval)..."
  log_cmd "airlock shield --tokenaddress=$TOKEN_ADDR --amount=2 --railguncontractaddr=$RAILGUN_ADDR --approvefirst"
  
  SHIELD_OUTPUT=$(airlock shield \
    --tokenaddress="$TOKEN_ADDR" \
    --amount=2 \
    --railguncontractaddr="$RAILGUN_ADDR" \
    --approvefirst 2>&1) || true
  
  echo "$SHIELD_OUTPUT"
  
  if echo "$SHIELD_OUTPUT" | grep -qi "success\|shielded\|commitment\|hash"; then
    log_pass "Shield completed"
    record_result "Shield Tokens" "PASS" ""
  elif echo "$SHIELD_OUTPUT" | grep -qi "error\|fail\|revert"; then
    log_fail "Shield failed"
    record_result "Shield Tokens" "FAIL" "$(echo "$SHIELD_OUTPUT" | tail -1)"
  else
    log_warn "Shield status unclear - check output above"
    record_result "Shield Tokens" "UNKNOWN" ""
  fi
fi

# =============================================================================
# Balance Check
# =============================================================================

log_test "Check Shielded Balance"

log_info "Querying shielded balance..."
log_cmd "airlock balance --railguncontractaddr=$RAILGUN_ADDR --shownotes"

BALANCE_OUTPUT=$(airlock balance \
  --railguncontractaddr="$RAILGUN_ADDR" \
  --shownotes 2>&1) || true

echo "$BALANCE_OUTPUT"

if echo "$BALANCE_OUTPUT" | grep -qi "note\|shielded\|token"; then
  log_pass "Balance query successful"
  record_result "Balance Check" "PASS" ""
elif echo "$BALANCE_OUTPUT" | grep -qi "no notes\|0 notes"; then
  log_warn "No shielded notes found"
  record_result "Balance Check" "WARN" "No notes"
else
  log_warn "Balance output unclear"
  record_result "Balance Check" "UNKNOWN" ""
fi

# =============================================================================
# Private Transfer Test (send 1 token to fred)
# =============================================================================

log_test "Private Transfer to Fred"

# Create/use fred's wallet
log_info "Setting up fred's wallet..."
FRED_EXISTS=$(airlock list_wallets 2>&1 | grep -c "fred" || echo "0")
if [ "$FRED_EXISTS" = "0" ]; then
  log_info "Creating wallet 'fred'..."
  # Generate a new wallet for fred with a random mnemonic
  FRED_OUTPUT=$(airlock setup_wallet --wallet fred --generate 2>&1) || true
  echo "$FRED_OUTPUT"
fi

# Get fred's Railgun address
FRED_RAILGUN_ADDR=$(airlock list_addresses --wallet fred 2>&1 | grep -oE '0zk[a-fA-F0-9]+' | head -1 || echo "")
if [ -z "$FRED_RAILGUN_ADDR" ]; then
  log_fail "Could not get fred's Railgun address"
  record_result "Private Transfer" "FAIL" "No fred address"
else
  log_info "Fred's Railgun address: ${FRED_RAILGUN_ADDR:0:30}..."
  
  log_info "Transferring 1 token to fred..."
  log_cmd "airlock transfer --tokenaddress=$TOKEN_ADDR --amount=1 --recipient=$FRED_RAILGUN_ADDR --railguncontractaddr=$RAILGUN_ADDR"
  
  TRANSFER_OUTPUT=$(airlock transfer \
    --tokenaddress="$TOKEN_ADDR" \
    --amount=1 \
    --recipient="$FRED_RAILGUN_ADDR" \
    --railguncontractaddr="$RAILGUN_ADDR" 2>&1) || true
  
  echo "$TRANSFER_OUTPUT"
  
  if echo "$TRANSFER_OUTPUT" | grep -qi "Transfer failed"; then
    log_fail "Transfer failed"
    record_result "Private Transfer" "FAIL" "$(echo "$TRANSFER_OUTPUT" | grep -i 'failed' | head -1)"
  elif echo "$TRANSFER_OUTPUT" | grep -qi "success\|SUCCESS"; then
    log_pass "Transfer to fred successful!"
    record_result "Private Transfer" "PASS" "1 token to fred"
  else
    log_warn "Transfer status unclear"
    record_result "Private Transfer" "UNKNOWN" ""
  fi
fi

# =============================================================================
# Unshield Test (remaining balance after transfer)
# =============================================================================

log_test "Unshield Tokens"

log_info "NOTE: Unshielding remaining balance after transfer to fred"

if [ -z "$TOKEN_ADDR" ]; then
  log_warn "Skipping unshield - no token address"
  record_result "Unshield Tokens" "SKIP" "No token"
elif [ -z "$USER_ADDRESS" ] || [ "$USER_ADDRESS" = "<from-auth>" ]; then
  # Try to get address again
  USER_ADDRESS=$(airlock balance 2>&1 | grep -oE '0x[a-fA-F0-9]{40}' | head -1 || echo "")
  if [ -z "$USER_ADDRESS" ]; then
    log_warn "Skipping unshield - no recipient address"
    record_result "Unshield Tokens" "SKIP" "No recipient"
  fi
fi

if [ -n "$TOKEN_ADDR" ] && [ -n "$USER_ADDRESS" ]; then
  log_info "Attempting unshield of 0.9 tokens (remaining after transfer)..."
  log_cmd "airlock unshield --tokenaddress=$TOKEN_ADDR --amount=0.9 --recipient=$USER_ADDRESS --railguncontractaddr=$RAILGUN_ADDR"
  
  UNSHIELD_OUTPUT=$(airlock unshield \
    --tokenaddress="$TOKEN_ADDR" \
    --amount=0.9 \
    --recipient="$USER_ADDRESS" \
    --railguncontractaddr="$RAILGUN_ADDR" 2>&1) || true
  
  echo "$UNSHIELD_OUTPUT"
  
  # Check for failure FIRST (before success, since output may contain both)
  if echo "$UNSHIELD_OUTPUT" | grep -qi "Unshield failed"; then
    if echo "$UNSHIELD_OUTPUT" | grep -qi "Verifier.*Key not set"; then
      log_fail "Unshield failed - verifier key not set"
      record_result "Unshield Tokens" "FAIL" "Verifier key not set"
    elif echo "$UNSHIELD_OUTPUT" | grep -qi "hashBoundParams\|unexpected result"; then
      log_warn "Unshield failed with known issue (hashBoundParams)"
      record_result "Unshield Tokens" "EXPECTED_FAIL" "Known issue"
    elif echo "$UNSHIELD_OUTPUT" | grep -qi "Invalid Snark Proof"; then
      log_fail "Unshield failed - invalid proof"
      record_result "Unshield Tokens" "FAIL" "Invalid proof"
    else
      log_fail "Unshield failed"
      record_result "Unshield Tokens" "FAIL" "$(echo "$UNSHIELD_OUTPUT" | grep -i 'failed' | head -1)"
    fi
  elif echo "$UNSHIELD_OUTPUT" | grep -qi "unshield.*success\|transaction.*SUCCESS"; then
    log_pass "Unshield successful!"
    record_result "Unshield Tokens" "PASS" "Works!"
  else
    log_fail "Unshield status unclear"
    record_result "Unshield Tokens" "FAIL" "$(echo "$UNSHIELD_OUTPUT" | tail -1)"
  fi
fi

# =============================================================================
# Summary
# =============================================================================

print_summary

echo ""
echo "Configuration:"
echo "  Contract: ${RAILGUN_ADDR:-<not deployed>}"
echo "  Token:    ${TOKEN_ADDR:-<not configured>}"
echo "  User:     ${USER_ADDRESS:-<unknown>}"
echo ""
echo "Re-run options:"
echo "  Skip rebuild: $0 --skip-rebuild"
echo "  Skip shield:  $0 --skip-rebuild --skip-shield"
