#!/bin/bash
#
# Deploy Railgun contract to STRATO
#
# Usage: ./deploy-railgun.sh

set -e

SCRIPT_DIR="$(dirname "$0")"
CONTRACT_FILE="$SCRIPT_DIR/../contracts/railgun.sol"

if [ ! -f "$CONTRACT_FILE" ]; then
    echo "Error: Contract file not found at $CONTRACT_FILE"
    exit 1
fi

echo "Deploying Railgun contract..."

# Build JSON payload with contract source
jq -n --arg src "$(cat "$CONTRACT_FILE")" '{
  txs: [{
    payload: {
      contract: "RailgunSmartWallet",
      src: $src,
      metadata: {VM: "SolidVM"}
    },
    type: "CONTRACT"
  }]
}' | restish strato post-bloc-transaction --resolve > /tmp/deploy-response.json

RESPONSE=$(cat /tmp/deploy-response.json)
ADDRESS=$(echo "$RESPONSE" | jq -r '.[0].data.contents.address // empty')
STATUS=$(echo "$RESPONSE" | jq -r '.[0].status // empty')

if [ "$STATUS" = "Success" ] && [ -n "$ADDRESS" ]; then
    echo "Contract deployed successfully!"
    echo "Address: $ADDRESS"
    
    # Save address to config file for other tools to use
    echo "$ADDRESS" > "$SCRIPT_DIR/.contract-address"
    echo "Saved to: $SCRIPT_DIR/.contract-address"
else
    echo "Deployment failed:"
    echo "$RESPONSE" | jq .
    exit 1
fi
