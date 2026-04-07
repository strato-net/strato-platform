#!/bin/bash
#
# Upgrade Railgun logic contract (preserves all data in proxy)
#
# Usage: ./upgrade-railgun.sh [proxy_address]
#        If no proxy address provided, reads from node's ethconf.yaml
#
# This script:
# 1. Deploys a new RailgunSmartWallet logic contract
# 2. Updates the proxy to point to the new logic
#
# All data (nullifiers, merkle tree, balances) is preserved in the proxy.

set -e

SCRIPT_DIR="$(dirname "$0")"
CONTRACT_FILE="$SCRIPT_DIR/../contracts/railgun.sol"
source "$SCRIPT_DIR/get-contract-address.sh"

# Get proxy address
if [ -n "$1" ]; then
    PROXY_ADDRESS="$1"
else
    PROXY_ADDRESS=$(get_railgun_address) || exit 1
fi

if [ ! -f "$CONTRACT_FILE" ]; then
    echo "Error: Contract file not found at $CONTRACT_FILE"
    exit 1
fi

echo "Upgrading Railgun at proxy: $PROXY_ADDRESS"

CONTRACT_SRC=$(cat "$CONTRACT_FILE")

echo ""
echo "Step 1: Deploying new RailgunSmartWallet logic contract..."

# Deploy new logic contract
LOGIC_RESPONSE=$(jq -n --arg src "$CONTRACT_SRC" '{
  txs: [{
    payload: {
      contract: "RailgunSmartWallet",
      src: $src,
      metadata: {VM: "SolidVM"}
    },
    type: "CONTRACT"
  }]
}' | restish strato post-bloc-transaction --resolve)

NEW_LOGIC_ADDRESS=$(echo "$LOGIC_RESPONSE" | jq -r '.[0].data.contents.address // empty')
LOGIC_STATUS=$(echo "$LOGIC_RESPONSE" | jq -r '.[0].status // empty')

if [ "$LOGIC_STATUS" != "Success" ] || [ -z "$NEW_LOGIC_ADDRESS" ]; then
    echo "New logic contract deployment failed:"
    echo "$LOGIC_RESPONSE" | jq .
    exit 1
fi

echo "New logic contract deployed: $NEW_LOGIC_ADDRESS"

echo ""
echo "Step 2: Updating proxy to use new logic..."

# Call setLogicContract on the proxy
"$SCRIPT_DIR/strato-call" "$PROXY_ADDRESS" setLogicContract "_logicContract=$NEW_LOGIC_ADDRESS"

echo ""
echo "=== Upgrade Complete ==="
echo "Proxy address:     $PROXY_ADDRESS (unchanged - users keep same address)"
echo "New logic:         $NEW_LOGIC_ADDRESS"
echo ""
echo "All data has been preserved. The proxy now uses the new logic."
