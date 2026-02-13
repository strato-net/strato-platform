#!/bin/bash
#
# Deploy Railgun contract to STRATO (behind upgradeable proxy)
#
# Usage: ./deploy-railgun.sh
#
# This script deploys:
# 1. RailgunSmartWallet (logic contract)
# 2. RailgunProxy (proxy contract pointing to the logic)
#
# Users interact with the proxy address. To upgrade, call setLogicContract() on the proxy.

set -e

SCRIPT_DIR="$(dirname "$0")"
CONTRACT_FILE="$SCRIPT_DIR/../contracts/railgun.sol"
source "$SCRIPT_DIR/refresh-token.sh"

if [ ! -f "$CONTRACT_FILE" ]; then
    echo "Error: Contract file not found at $CONTRACT_FILE"
    exit 1
fi

# Get deployer address for ownership
echo "Getting user address..."
TOKEN=$(ensure_valid_token) || exit 1
HOST=${STRATO_HOST:-localhost:8081}
USER_ADDR=$(curl -s -H "Authorization: Bearer $TOKEN" "http://$HOST/strato/v2.3/key" | jq -r '.address')

if [ -z "$USER_ADDR" ] || [ "$USER_ADDR" = "null" ]; then
    echo "Error: Could not get user address"
    exit 1
fi
echo "Deployer address: $USER_ADDR"

CONTRACT_SRC=$(cat "$CONTRACT_FILE")

echo ""
echo "Step 1: Deploying RailgunSmartWallet (logic contract)..."

# Deploy logic contract
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

LOGIC_ADDRESS=$(echo "$LOGIC_RESPONSE" | jq -r '.[0].data.contents.address // empty')
LOGIC_STATUS=$(echo "$LOGIC_RESPONSE" | jq -r '.[0].status // empty')

if [ "$LOGIC_STATUS" != "Success" ] || [ -z "$LOGIC_ADDRESS" ]; then
    echo "Logic contract deployment failed:"
    echo "$LOGIC_RESPONSE" | jq .
    exit 1
fi

echo "Logic contract deployed: $LOGIC_ADDRESS"

echo ""
echo "Step 2: Deploying RailgunProxy..."

# Deploy proxy contract with logic address and owner
PROXY_RESPONSE=$(jq -n --arg src "$CONTRACT_SRC" --arg logic "$LOGIC_ADDRESS" --arg owner "$USER_ADDR" '{
  txs: [{
    payload: {
      contract: "RailgunProxy",
      src: $src,
      args: {
        _logicContract: $logic,
        _initialOwner: $owner
      },
      metadata: {VM: "SolidVM"}
    },
    type: "CONTRACT"
  }]
}' | restish strato post-bloc-transaction --resolve)

PROXY_ADDRESS=$(echo "$PROXY_RESPONSE" | jq -r '.[0].data.contents.address // empty')
PROXY_STATUS=$(echo "$PROXY_RESPONSE" | jq -r '.[0].status // empty')

if [ "$PROXY_STATUS" != "Success" ] || [ -z "$PROXY_ADDRESS" ]; then
    echo "Proxy contract deployment failed:"
    echo "$PROXY_RESPONSE" | jq .
    exit 1
fi

echo "Proxy contract deployed: $PROXY_ADDRESS"

echo ""
echo "=== Deployment Complete ==="
echo "Logic contract:  $LOGIC_ADDRESS"
echo "Proxy contract:  $PROXY_ADDRESS (this is the address users interact with)"
echo ""
echo "Next step: Run init-railgun.sh $PROXY_ADDRESS to initialize"

# Save proxy address as the main contract address
echo "$PROXY_ADDRESS" > "$SCRIPT_DIR/.contract-address"
echo "Saved proxy address to: $SCRIPT_DIR/.contract-address"

# Also save logic address for reference
echo "$LOGIC_ADDRESS" > "$SCRIPT_DIR/.logic-address"
echo "Saved logic address to: $SCRIPT_DIR/.logic-address"
