#!/bin/bash
#
# Set verification key on Railgun contract
#
# Usage: ./set-verifier-key.sh <nullifiers> <commitments> [contract_address]
#        If no contract address, reads from .contract-address

set -e

SCRIPT_DIR="$(dirname "$0")"
CONTRACT_FILE="$SCRIPT_DIR/.contract-address"
KEYS_DIR="$SCRIPT_DIR/verifier-keys"

if [ $# -lt 2 ]; then
    echo "Usage: $0 <nullifiers> <commitments> [contract_address]"
    echo "Example: $0 1 1"
    echo "         $0 1 2 95be101d075f44084ca1cf51d0106c8606773952"
    exit 1
fi

NULLIFIERS="$1"
COMMITMENTS="$2"

if [ -n "$3" ]; then
    CONTRACT_ADDR="$3"
elif [ -f "$CONTRACT_FILE" ]; then
    CONTRACT_ADDR=$(cat "$CONTRACT_FILE" | tr -d '[:space:]')
else
    echo "Error: No contract address provided and $CONTRACT_FILE not found"
    echo "       Run deploy-railgun.sh first or provide address as argument"
    exit 1
fi

KEY_FILE="${KEYS_DIR}/key-${NULLIFIERS}-${COMMITMENTS}.json"
if [ ! -f "$KEY_FILE" ]; then
    echo "Error: Verifier key file not found at $KEY_FILE"
    echo "Available keys:"
    ls -1 "$KEYS_DIR"/*.json 2>/dev/null || echo "  (none)"
    exit 1
fi

echo "Setting verification key for circuit ($NULLIFIERS, $COMMITMENTS) on contract $CONTRACT_ADDR..."

# Read the verifier key JSON and pass it directly
VERIFYING_KEY=$(cat "$KEY_FILE")

RESPONSE=$("$SCRIPT_DIR/strato-call" "$CONTRACT_ADDR" setVerificationKey \
    "_nullifiers=$NULLIFIERS" \
    "_commitments=$COMMITMENTS" \
    "_verifyingKey=$VERIFYING_KEY")

STATUS=$(echo "$RESPONSE" | jq -r '.[0].status // empty')

if [ "$STATUS" = "Success" ]; then
    echo "Verification key set successfully!"
else
    echo "Failed to set verification key:"
    echo "$RESPONSE" | jq .
    exit 1
fi
