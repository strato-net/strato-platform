#!/bin/bash
#
# Set verification key on Railgun contract
#
# Usage: ./set-verifier-key.sh <contract_address> <nullifiers> <commitments> [base_url]
#   contract_address: Address of deployed RailgunSmartWallet
#   nullifiers: Number of nullifiers (e.g., 1)
#   commitments: Number of commitments (e.g., 1)
#   base_url: defaults to http://localhost:8081
#

set -e

if [ $# -lt 3 ]; then
    echo "Usage: $0 <contract_address> <nullifiers> <commitments> [base_url]"
    echo "Example: $0 959b55477e53900402fdbb2633b56709d252cadd 1 1"
    exit 1
fi

CONTRACT_ADDR="$1"
NULLIFIERS="$2"
COMMITMENTS="$3"
BASE_URL="${4:-http://localhost:8081}"
TOKEN_FILE="${HOME}/.secrets/stratoToken"
KEYS_DIR="$(dirname "$0")/verifier-keys"

if [ ! -f "$TOKEN_FILE" ]; then
    echo "Error: Token file not found at $TOKEN_FILE"
    echo "Run 'airlock login' first"
    exit 1
fi

KEY_FILE="${KEYS_DIR}/key-${NULLIFIERS}-${COMMITMENTS}.json"
if [ ! -f "$KEY_FILE" ]; then
    echo "Error: Verifier key file not found at $KEY_FILE"
    echo "Available keys:"
    ls -1 "$KEYS_DIR"/*.json 2>/dev/null || echo "  (none)"
    exit 1
fi

# Extract access_token from JSON file
TOKEN=$(jq -r '.access_token' "$TOKEN_FILE")
VERIFYING_KEY=$(cat "$KEY_FILE")

echo "Setting verification key for circuit ($NULLIFIERS, $COMMITMENTS) on contract $CONTRACT_ADDR..."

RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"txs\": [{
            \"type\": \"FUNCTION\",
            \"payload\": {
                \"contractAddress\": \"$CONTRACT_ADDR\",
                \"method\": \"setVerificationKey\",
                \"args\": {
                    \"_nullifiers\": $NULLIFIERS,
                    \"_commitments\": $COMMITMENTS,
                    \"_verifyingKey\": $VERIFYING_KEY
                },
                \"metadata\": {\"VM\": \"SolidVM\"}
            }
        }]
    }" \
    "${BASE_URL}/strato-api/bloc/v2.2/transaction?resolve")

echo "Response:"
echo "$RESPONSE" | jq .
