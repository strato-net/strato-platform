#!/bin/bash
#
# Upgrade Railgun logic contract (preserves all data in proxy)
#
# Usage: ./upgrade-railgun.sh [proxy_address]
#        If no proxy address provided, reads from .contract-address
#
# This script:
# 1. Deploys a new RailgunSmartWallet logic contract
# 2. Updates the proxy to point to the new logic
#
# All data (nullifiers, merkle tree, balances) is preserved in the proxy.

set -e

SCRIPT_DIR="$(dirname "$0")"
CONTRACT_FILE="$SCRIPT_DIR/../contracts/railgun.sol"
source "$SCRIPT_DIR/refresh-token.sh"

# Get proxy address
if [ -n "$1" ]; then
    PROXY_ADDRESS="$1"
else
    if [ -f "$SCRIPT_DIR/.contract-address" ]; then
        PROXY_ADDRESS=$(cat "$SCRIPT_DIR/.contract-address")
    else
        echo "Error: No proxy address provided and .contract-address not found"
        echo "Usage: $0 [proxy_address]"
        exit 1
    fi
fi

if [ ! -f "$CONTRACT_FILE" ]; then
    echo "Error: Contract file not found at $CONTRACT_FILE"
    exit 1
fi

echo "Upgrading Railgun at proxy: $PROXY_ADDRESS"

# Get old logic address for reference
OLD_LOGIC=""
if [ -f "$SCRIPT_DIR/.logic-address" ]; then
    OLD_LOGIC=$(cat "$SCRIPT_DIR/.logic-address")
    echo "Current logic contract: $OLD_LOGIC"
fi

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
echo "Old logic:         ${OLD_LOGIC:-unknown}"
echo "New logic:         $NEW_LOGIC_ADDRESS"
echo ""
echo "All data has been preserved. The proxy now uses the new logic."

# Update saved logic address
echo "$NEW_LOGIC_ADDRESS" > "$SCRIPT_DIR/.logic-address"
echo "Updated .logic-address"
