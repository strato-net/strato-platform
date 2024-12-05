# Define input parameters directly in the script
USERNAME="blockapps"
PASSWORD="Bl0ck@pps"
ASSET_ROOT_ADDRESS="8e07e5a157982e3a8db4491f674632a750e863fe"

# Get access token
ACCESS_TOKEN=$(curl -L -X POST "https://keycloak.blockapps.net/auth/realms/mercata-testnet2/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Authorization: Basic bG9jYWxob3N0LWRhdmlkLW46ZjEyNzdkNTUtOGUwNy00NzIwLWI1N2ItOGJiMjBmOWRiMmM0' \
  --data-urlencode 'grant_type=password' \
  --data-urlencode "username=$USERNAME" \
  --data-urlencode "password=$PASSWORD" \
  -s | jq -r '.access_token')

echo "Access token: $ACCESS_TOKEN"

# Function to fetch previous reserves
fetch_previous_reserves() {
  local asset_root_address=$1
  local access_token=$2

  local encoded_address=$(printf '%s' "$asset_root_address" | jq -sRr @uri)
  local response=$(curl -s -H "Authorization: Bearer $access_token" \
    -H "Content-Type: application/json" \
    "https://node1.mercata-testnet2.blockapps.net/cirrus/search/BlockApps-Mercata-Reserve?isActive=eq.true&creator=eq.BlockApps&assetRootAddress=eq.$encoded_address&select=address,stratsToken,cataToken")

  if ! echo "$response" | jq empty 2>/dev/null; then
    echo "Error: Non-JSON response."
    return 1
  fi

  if [ "$(echo "$response" | jq length)" -eq 0 ]; then
    echo "No previous reserves found for asset root address $asset_root_address."
    return 1
  fi

  echo "$response"
}

# Get previous reserves
PREVIOUS_RESERVES=$(fetch_previous_reserves "$ASSET_ROOT_ADDRESS" "$ACCESS_TOKEN")

# Check if fetch was successful
if [ $? -ne 0 ]; then
    echo "Failed to fetch previous reserves"
    exit 1
fi

# Process each reserve address
echo "$PREVIOUS_RESERVES" | jq -c '.[]' | while read -r reserve; do
    RESERVE_ADDRESS=$(echo "$reserve" | jq -r '.address')
    echo "Deactivating reserve: $RESERVE_ADDRESS"
    
    DEACTIVATE_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -d '{
            "txs":[{
                "payload":{
                    "contractAddress":"'"$RESERVE_ADDRESS"'",
                    "method":"deactivate",
                    "args":{}
                },
                "type":"FUNCTION"
            }],
            "txParams":{"gasLimit":10000000000,"gasPrice":1}
        }')

    echo "DEACTIVATE_RESULT for $RESERVE_ADDRESS: $DEACTIVATE_RESULT"
done