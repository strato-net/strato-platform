#!/bin/bash
#
# Initialize Railgun contract after deployment
#
# Usage: ./init-railgun.sh <contract_address>

set -e

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/refresh-token.sh"

if [ -z "$1" ]; then
    echo "Usage: ./init-railgun.sh <contract_address>"
    exit 1
fi

CONTRACT_ADDR="$1"

# Get user's address for treasury
echo "Getting user address..."
TOKEN=$(ensure_valid_token) || exit 1
USER_ADDR=$(restish strato get-eth-account | jq -r '.address')

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

STATUS=$(echo "$RESPONSE" | jq -r '.[0].status // empty')

if [ "$STATUS" = "Success" ]; then
    echo "Railgun contract initialized successfully!"
    echo "Treasury: $USER_ADDR"
    echo "Shield fee: 0.25%"
    echo "Unshield fee: 0.25%"
else
    echo "Initialization failed:"
    echo "$RESPONSE" | jq .
    exit 1
fi
