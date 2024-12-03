# Define input parameters directly in the script
USERNAME="blockapps"
PASSWORD="Bl0ck@pps"
CATA_QUANTITY="100" #1000000000000000000000000000000
STRATS_QUANTITY="400" #100,000
BA_STRATS_ADDRESS="185000c816bf9bdca97606b31e727f9fac9b50c3"
BA_CATA_ADDRESS="e64fac120eef3e3551cfe914af7dfb58d4f0beef"
BASE_CODE_COLLECTION="f6407278a511fb990106b2aa48d072385538d610"
SILVER_ASSET_ROOT_ADDRESS="8e07e5a157982e3a8db4491f674632a750e863fe"
NAME="Silver"
ASSET_ORACLE_ADDRESS="67242231385bf8ce692a246933e9181fea3742d7"


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

# Deploy the SimpleReserve contract
SIMPLE_RESERVE_ADDRESS=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "txs": [{
      "payload": {
        "src": "pragma es6; pragma strict; import \"<\$BASE_CODE_COLLECTION>\"; contract SimpleReserve is Reserve { constructor(address _assetOracle, string _name, address _assetRootAddress) Reserve (_assetOracle, _name, _assetRootAddress) {} }",
        "contract": "SimpleReserve",
        "function": "constructor",
        "args": {
          "_assetOracle": ""$ASSET_ORACLE_ADDRESS",
          "_name": "$NAME",
          "_assetRootAddress": "'"$ASSET_ROOT_ADDRESS"'"
        }
      },
      "type": "CONTRACT"
    }],
    "txParams": {
      "gasLimit": 10000000000,
      "gasPrice": 1
    }
  }' )

echo "SimpleReserve for $NAME contract deployed at address: $SIMPLE_RESERVE_ADDRESS"

# Use the access token to call purchaseTransfer for STRATS
curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"txs":[{"payload":{"contract":"STRATS","function":"purchaseTransfer","args":{"_newOwner":"'"$RESERVE_ADDRESS"'","_quantity":'"$STRATS_QUANTITY"',"_transferNumber":'"$TRANSFER_NUMBER"',"_price":0.01}},"type":"CONTRACT"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}'

# Use the access token to call purchaseTransfer for CATA
curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"txs":[{"payload":{"contract":"CATA","function":"purchaseTransfer","args":{"_newOwner":"'"$RESERVE_ADDRESS"'","_quantity":'"$CATA_QUANTITY"',"_transferNumber":'"$TRANSFER_NUMBER"',"_price":0.1}},"type":"CONTRACT"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}'

# Fetch and parse the new STRATS address
NEW_STRATS_ADDRESS=$(curl -s "https://node1.mercata-testnet2.blockapps.net/cirrus/search/BlockApps-Mercata-Asset?name=eq.STRATS&owner=eq.$SIMPLE_RESERVE_ADDRESS" | jq -r '.address')

# Fetch and parse the new CATA address
NEW_CATA_ADDRESS=$(curl -s "https://node1.mercata-testnet2.blockapps.net/cirrus/search/BlockApps-Mercata-Asset?name=eq.CATA&owner=eq.$SIMPLE_RESERVE_ADDRESS" | jq -r '.address')

# Update STRATS token address
curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"txs":[{"payload":{"contract":"Reserve","function":"setStratsToken","args":{"_newStratsToken":"'"$NEW_STRATS_ADDRESS"'"}},"type":"CONTRACT"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}'

# Update CATA token address
curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"txs":[{"payload":{"contract":"Reserve","function":"setCATAToken","args":{"_newCATAToken":"'"$NEW_CATA_ADDRESS"'"}},"type":"CONTRACT"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}'
