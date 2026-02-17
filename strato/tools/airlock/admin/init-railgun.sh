#!/bin/bash
#
# Initialize Railgun contract after deployment
#
# Usage: ./init-railgun.sh [contract_address]
#        If no address provided, reads from node's ethconf.yaml

set -e

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/refresh-token.sh"
source "$SCRIPT_DIR/get-contract-address.sh"

if [ -n "$1" ]; then
    CONTRACT_ADDR="$1"
else
    CONTRACT_ADDR=$(get_railgun_address) || exit 1
fi

# Get user's address for treasury
echo "Getting user address..."
TOKEN=$(ensure_valid_token) || exit 1
# Get current user's address from the key endpoint
HOST=${STRATO_HOST:-localhost:8081}
USER_ADDR=$(curl -s -H "Authorization: Bearer $TOKEN" "http://$HOST/strato/v2.3/key" | jq -r '.address')

if [ -z "$USER_ADDR" ] || [ "$USER_ADDR" = "null" ]; then
    echo "Error: Could not get user address"
    exit 1
fi

echo "User address: $USER_ADDR"
echo "Initializing Railgun contract at $CONTRACT_ADDR..."

# Initialize with 0.25% fees
RESPONSE=$("$SCRIPT_DIR/strato-call" "$CONTRACT_ADDR" initializeRailgunLogic \
    "_treasury=$USER_ADDR" \
    "_shieldFee=25" \
    "_unshieldFee=25" \
    "_nftFee=25" \
    "_owner=$USER_ADDR")

STATUS=$(echo "$RESPONSE" | jq -r '.[0].status // empty' 2>/dev/null)

if [ "$STATUS" = "Success" ]; then
    echo "Railgun contract initialized successfully!"
    echo "Treasury: $USER_ADDR"
    echo "Shield fee: 0.25%"
    echo "Unshield fee: 0.25%"
else
    echo "Initialization failed:"
    # Try to pretty-print as JSON, fall back to raw output
    echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
    exit 1
fi
