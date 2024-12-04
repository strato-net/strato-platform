# Define input parameters directly in the script
USERNAME="blockapps"
PASSWORD="Bl0ck@pps"
CATA_QUANTITY="100" #1000000000000000000000000000000
STRATS_QUANTITY="400" #100,000
BA_STRATS_ADDRESS="185000c816bf9bdca97606b31e727f9fac9b50c3"
BA_CATA_ADDRESS="e64fac120eef3e3551cfe914af7dfb58d4f0beef"
BASE_CODE_COLLECTION="3ef5e4896acfe076ac52e19892351fa177306691"
ASSET_ROOT_ADDRESS=$ASSET_ROOT_ADDRESS
NAME=$NAME
ASSET_ORACLE_ADDRESS=$ASSET_ORACLE_ADDRESS
UNIT_CONVERSION_RATE=$UNIT_CONVERSION_RATE
OLD_RESERVE_ADDRESS=$OLD_RESERVE_ADDRESS

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
        "src": "pragma es6; pragma strict; import <'"$BASE_CODE_COLLECTION"'>; contract SimpleReserve is Reserve { constructor(address _assetOracle, string _name, address _assetRootAddress, decimal _unitConversionRate) Reserve (_assetOracle, _name, _assetRootAddress, _unitConversionRate) {} }",
        "contract": "SimpleReserve",
        "function": "constructor",
        "args": {
          "_assetOracle": "'"$ASSET_ORACLE_ADDRESS"'",
          "_name": "'"$NAME"'",
          "_assetRootAddress": "'"$ASSET_ROOT_ADDRESS"'",
          "_unitConversionRate": '"$UNIT_CONVERSION_RATE"'
        }
      },
      "type": "CONTRACT"
    }],
    "txParams": {
      "gasLimit": 10000000000,
      "gasPrice": 1
    }
  }' | jq -r '.[0].data.contents.address')

echo "SimpleReserve for $NAME contract deployed at address: $SIMPLE_RESERVE_ADDRESS"

# Use the access token to call purchaseTransfer for STRATS
NEW_STRATS_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"txs":[{"payload":{"contractAddress":"'"$BA_STRATS_ADDRESS"'","method":"automaticTransfer","args":{"_newOwner":"'"$SIMPLE_RESERVE_ADDRESS"'","_quantity":'"$STRATS_QUANTITY"',"_transferNumber":'"$TRANSFER_NUMBER"',"_price":0.01}},"type":"FUNCTION"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}')

echo "NEW_STRATS_RESULT: $NEW_STRATS_RESULT"

NEW_STRATS_ADDRESS=$(echo $NEW_STRATS_RESULT | jq -r '.[0].txResult.contractsCreated')

echo "NEW_STRATS_ADDRESS: $NEW_STRATS_ADDRESS"

# Use the access token to call purchaseTransfer for CATA
NEW_CATA_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"txs":[{"payload":{"contractAddress":"'"$BA_CATA_ADDRESS"'","method":"automaticTransfer","args":{"_newOwner":"'"$SIMPLE_RESERVE_ADDRESS"'","_quantity":'"$CATA_QUANTITY"',"_transferNumber":'"$TRANSFER_NUMBER"',"_price":0.1}},"type":"FUNCTION"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}')

echo "NEW_CATA_RESULT: $NEW_CATA_RESULT"

NEW_CATA_ADDRESS=$(echo $NEW_CATA_RESULT | jq -r '.[0].txResult.contractsCreated')

echo "NEW_CATA_ADDRESS: $NEW_CATA_ADDRESS"

# Fetch and parse the new STRATS address
# NEW_STRATS_ADDRESS=$(curl -s "https://node1.mercata-testnet2.blockapps.net/cirrus/search/BlockApps-Mercata-Asset?name=eq.STRATS&owner=eq.$SIMPLE_RESERVE_ADDRESS" | jq -r '.address')

# Fetch and parse the new CATA address
# NEW_CATA_ADDRESS=$(curl -s "https://node1.mercata-testnet2.blockapps.net/cirrus/search/BlockApps-Mercata-Asset?name=eq.CATA&owner=eq.$SIMPLE_RESERVE_ADDRESS" | jq -r '.address')

# Update STRATS token address
UPDATE_STRATS_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"txs":[{"payload":{"contractAddress":"'"$SIMPLE_RESERVE_ADDRESS"'","method":"setStratsToken","args":{"_newStratsToken":"'"$NEW_STRATS_ADDRESS"'"}},"type":"FUNCTION"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}')

echo "UPDATE_STRATS_RESULT: $UPDATE_STRATS_RESULT"

# Update CATA token address
UPDATE_CATA_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"txs":[{"payload":{"contractAddress":"'"$SIMPLE_RESERVE_ADDRESS"'","method":"setCataToken","args":{"_newCataToken":"'"$NEW_CATA_ADDRESS"'"}},"type":"FUNCTION"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}')

echo "UPDATE_CATA_RESULT: $UPDATE_CATA_RESULT"

# Migrate escrows and deactivate old reserve only if OLD_RESERVE_ADDRESS is set
if [ ! -z "$OLD_RESERVE_ADDRESS" ]; then
    echo "Migrating escrows from old reserve to new reserve..."

    MIGRATE_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -d '{
        "txs":[{
          "payload":{
            "contractAddress":"'"$OLD_RESERVE_ADDRESS"'",
            "method":"migrateReserve",
            "args":{
              "_newReserve":"'"$SIMPLE_RESERVE_ADDRESS"'",
              "_escrows":[]
            }
          },
          "type":"FUNCTION"
        }],
        "txParams":{"gasLimit":10000000000,"gasPrice":1}
      }')

    echo "MIGRATE_RESULT: $MIGRATE_RESULT"

    # Deactivate old reserve
    DEACTIVATE_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -d '{
        "txs":[{
          "payload":{
            "contractAddress":"'"$OLD_RESERVE_ADDRESS"'",
            "method":"deactivate",
            "args":{}
          },
          "type":"FUNCTION"
        }],
        "txParams":{"gasLimit":10000000000,"gasPrice":1}
      }')

    echo "DEACTIVATE_RESULT: $DEACTIVATE_RESULT"
fi

# After deploying new reserve, store its address
if grep -q "^$NAME:" reserve_addresses.txt; then
    # If entry exists, replace the address
    sed -i "s|^$NAME:.*|$NAME:$SIMPLE_RESERVE_ADDRESS|" reserve_addresses.txt
else
    # If entry doesn't exist, append new line
    echo "$NAME:$SIMPLE_RESERVE_ADDRESS" >> reserve_addresses.txt
fi

