# Define input parameters directly in the script
USERNAME=""
PASSWORD=""
CATA_QUANTITY="1000000000000000000000000000000" 
USDST_TOKEN_ADDRESS="2f6c3848a75aa075d054fe84b780cbdebd77ec61"
BA_CATA_ADDRESS="e64fac120eef3e3551cfe914af7dfb58d4f0beef"
BASE_CODE_COLLECTION="8a3ae8e43f1786a699ea1df376d04195895983c9"
ASSET_ROOT_ADDRESS=$ASSET_ROOT_ADDRESS
NAME=$NAME
ASSET_ORACLE_ADDRESS=$ASSET_ORACLE_ADDRESS
UNIT_CONVERSION_RATE=$UNIT_CONVERSION_RATE
SKIP_TOKENS=$SKIP_TOKENS


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

# Deploy the SimpleReserve contract and capture the raw response
RAW_RESPONSE=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "txs": [{
      "payload": {
        "src": "pragma es6; pragma strict; import <'"$BASE_CODE_COLLECTION"'>; contract SimpleReserve is Reserve { constructor(address _assetOracle, string _name, address _assetRootAddress, decimal _unitConversionRate, address _usdstToken, decimal _usdstPrice, decimal _stratsPrice ) Reserve (_assetOracle, _name, _assetRootAddress, _unitConversionRate, _usdstToken, _usdstPrice, _stratsPrice) {} }",
        "contract": "SimpleReserve",
        "function": "constructor",
        "args": {
          "_assetOracle": "'"$ASSET_ORACLE_ADDRESS"'",
          "_name": "'"$NAME"'",
          "_assetRootAddress": "'"$ASSET_ROOT_ADDRESS"'",
          "_unitConversionRate": '"$UNIT_CONVERSION_RATE"',
          "_usdstToken": "'"$USDST_TOKEN_ADDRESS"'",
          "_usdstPrice": 1000000000000000000.0000,
          "_stratsPrice": 100000000000000.0000
        }
      },
      "type": "CONTRACT"
    }],
    "txParams": {
      "gasLimit": 10000000000,
      "gasPrice": 1
    }
  }')

echo "RAW_RESPONSE: $RAW_RESPONSE"

# Parse the address from the raw response
SIMPLE_RESERVE_ADDRESS=$(echo $RAW_RESPONSE | jq -r '.[0].data.contents.address')

echo "SimpleReserve for $NAME contract deployed at address: $SIMPLE_RESERVE_ADDRESS"

# if SKIP_TOKENS is not set, deploy STRATS and CATA tokens
if [ "$SKIP_TOKENS" != "true" ]; then
  # Use the access token to call purchaseTransfer for CATA
  NEW_CATA_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -d '{"txs":[{"payload":{"contractAddress":"'"$BA_CATA_ADDRESS"'","method":"automaticTransfer","args":{"_newOwner":"'"$SIMPLE_RESERVE_ADDRESS"'","_quantity":'"$CATA_QUANTITY"',"_transferNumber":'"$TRANSFER_NUMBER"',"_price":0.1}},"type":"FUNCTION"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}')

  echo "NEW_CATA_RESULT: $NEW_CATA_RESULT"

  NEW_CATA_ADDRESS=$(echo $NEW_CATA_RESULT | jq -r '.[0].txResult.contractsCreated')

  echo "NEW_CATA_ADDRESS: $NEW_CATA_ADDRESS"

  # Update CATA token address
  UPDATE_CATA_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -d '{"txs":[{"payload":{"contractAddress":"'"$SIMPLE_RESERVE_ADDRESS"'","method":"setCataToken","args":{"_newCataToken":"'"$NEW_CATA_ADDRESS"'"}},"type":"FUNCTION"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}')

  echo "UPDATE_CATA_RESULT: $UPDATE_CATA_RESULT"
fi