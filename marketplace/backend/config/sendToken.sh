USERNAME=""
PASSWORD=""


USDST_ADDRESS="e64fac120eef3e3551cfe914af7dfb58d4f0beef"
SIMPLE_RESERVE_ADDRESS="758834d4c9d52949ee4d04423eceb222e171388e"
USDST_QUANTITY="1000000000000000000000000000000"
# NEW_USDST_ADDRESS="46cfcbebc2f2094e66ac55f2375f6e5b6e029fed"
# Get access token
ACCESS_TOKEN=$(curl -L -X POST "https://keycloak.blockapps.net/auth/realms/mercata-testnet2/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Authorization: Basic bG9jYWxob3N0LWRhdmlkLW46ZjEyNzdkNTUtOGUwNy00NzIwLWI1N2ItOGJiMjBmOWRiMmM0' \
  --data-urlencode 'grant_type=password' \
  --data-urlencode "username=$USERNAME" \
  --data-urlencode "password=$PASSWORD" \
  -s | jq -r '.access_token')

echo "Access token: $ACCESS_TOKEN"

# Generate a random transfer number
TRANSFER_NUMBER=$(shuf -i 1000-9999 -n 1)

# Use the access token to call purchaseTransfer for CATA
NEW_USDST_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
-H 'Content-Type: application/json' \
-H "Authorization: Bearer $ACCESS_TOKEN" \
-d '{"txs":[{"payload":{"contractAddress":"'"$USDST_ADDRESS"'","method":"automaticTransfer","args":{"_newOwner":"'"$SIMPLE_RESERVE_ADDRESS"'","_quantity":'"$USDST_QUANTITY"',"_transferNumber":'"$TRANSFER_NUMBER"',"_price":0.1}},"type":"FUNCTION"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}')

echo "NEW_USDST_RESULT: $NEW_USDST_RESULT"

NEW_USDST_ADDRESS=$(echo $NEW_USDST_RESULT | jq -r '.[0].txResult.contractsCreated')


USERNAME2=""
PASSWORD2=""

# Get access token
ACCESS_TOKEN2=$(curl -L -X POST "https://keycloak.blockapps.net/auth/realms/mercata-testnet2/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Authorization: Basic bG9jYWxob3N0LWRhdmlkLW46ZjEyNzdkNTUtOGUwNy00NzIwLWI1N2ItOGJiMjBmOWRiMmM0' \
  --data-urlencode 'grant_type=password' \
  --data-urlencode "username=$USERNAME2" \
  --data-urlencode "password=$PASSWORD2" \
  -s | jq -r '.access_token')

echo "Access token: $ACCESS_TOKEN2"

# Update STRATS token address
UPDATE_USDST_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN2" \
  -d '{"txs":[{"payload":{"contractAddress":"'"$SIMPLE_RESERVE_ADDRESS"'","method":"setCATAToken","args":{"_newCATAToken":"'"$NEW_USDST_ADDRESS"'"}},"type":"FUNCTION"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}')

echo "UPDATE_USDST_RESULT: $UPDATE_USDST_RESULT"