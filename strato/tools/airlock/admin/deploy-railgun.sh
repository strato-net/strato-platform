#!/bin/bash
#
# Deploy Railgun contract to STRATO
#
# Usage: ./deploy-railgun.sh [base_url]
#   base_url defaults to http://localhost:8081
#

set -e

BASE_URL="${1:-http://localhost:8081}"
TOKEN_FILE="${HOME}/.secrets/stratoToken"
CONTRACT_FILE="$(dirname "$0")/../contracts/railgun.sol"

if [ ! -f "$TOKEN_FILE" ]; then
    echo "Error: Token file not found at $TOKEN_FILE"
    echo "Run 'airlock login' first"
    exit 1
fi

if [ ! -f "$CONTRACT_FILE" ]; then
    echo "Error: Contract file not found at $CONTRACT_FILE"
    exit 1
fi

# Extract access_token from JSON file
TOKEN=$(jq -r '.access_token' "$TOKEN_FILE")
SOURCE=$(cat "$CONTRACT_FILE" | jq -Rs .)

echo "Deploying Railgun contract to $BASE_URL..."

RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"txs\": [{\"type\": \"CONTRACT\", \"payload\": {\"contract\": \"RailgunSmartWallet\", \"src\": $SOURCE, \"metadata\": {\"VM\": \"SolidVM\"}}}]}" \
    "${BASE_URL}/strato-api/bloc/v2.2/transaction?resolve")

echo "Response:"
echo "$RESPONSE" | jq .

# Extract contract address if successful
ADDRESS=$(echo "$RESPONSE" | jq -r '.[0].data.contents // empty')
if [ -n "$ADDRESS" ]; then
    echo ""
    echo "Contract deployed at: $ADDRESS"
fi
