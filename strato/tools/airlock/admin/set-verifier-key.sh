#!/bin/bash
#
# Set verification key on Railgun contract
#
# Usage: ./set-verifier-key.sh <contract_address> <nullifiers> <commitments>

set -e

SCRIPT_DIR="$(dirname "$0")"

if [ $# -lt 3 ]; then
    echo "Usage: $0 <contract_address> <nullifiers> <commitments>"
    echo "Example: $0 95be101d075f44084ca1cf51d0106c8606773952 1 1"
    exit 1
fi

CONTRACT_ADDR="$1"
NULLIFIERS="$2"
COMMITMENTS="$3"
KEYS_DIR="$SCRIPT_DIR/verifier-keys"

KEY_FILE="${KEYS_DIR}/key-${NULLIFIERS}-${COMMITMENTS}.json"
if [ ! -f "$KEY_FILE" ]; then
    echo "Error: Verifier key file not found at $KEY_FILE"
    echo "Available keys:"
    ls -1 "$KEYS_DIR"/*.json 2>/dev/null || echo "  (none)"
    exit 1
fi

echo "Setting verification key for circuit ($NULLIFIERS, $COMMITMENTS) on contract $CONTRACT_ADDR..."

VERIFYING_KEY=$(cat "$KEY_FILE")

jq -n \
    --arg addr "$CONTRACT_ADDR" \
    --argjson nullifiers "$NULLIFIERS" \
    --argjson commitments "$COMMITMENTS" \
    --argjson vk "$VERIFYING_KEY" '{
  txs: [{
    type: "FUNCTION",
    payload: {
      contractAddress: $addr,
      method: "setVerificationKey",
      args: {
        _nullifiers: $nullifiers,
        _commitments: $commitments,
        _verifyingKey: $vk
      },
      metadata: {VM: "SolidVM"}
    }
  }]
}' | restish strato post-bloc-transaction --resolve > /tmp/setkey-response.json

RESPONSE=$(cat /tmp/setkey-response.json)
STATUS=$(echo "$RESPONSE" | jq -r '.[0].status // empty')

if [ "$STATUS" = "Success" ]; then
    echo "Verification key set successfully!"
else
    echo "Failed to set verification key:"
    echo "$RESPONSE" | jq .
    exit 1
fi
