#!/bin/bash

# Function to get access token
get_access_token() {
  local username=$1
  local password=$2

  local access_token=$(curl -L -X POST "https://keycloak.blockapps.net/auth/realms/mercata-testnet2/protocol/openid-connect/token" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -H 'Authorization: Basic bG9jYWxob3N0LWRhdmlkLW46ZjEyNzdkNTUtOGUwNy00NzIwLWI1N2ItOGJiMjBmOWRiMmM0' \
    --data-urlencode 'grant_type=password' \
    --data-urlencode "username=$username" \
    --data-urlencode "password=$password" \
    -s | jq -r '.access_token')

  if [ -z "$access_token" ]; then
    echo "Error: Failed to retrieve access token."
    exit 1
  fi

  echo "$access_token"
}

# Function to fetch token balance
fetch_token_balance() {
  local token_address=$1
  local access_token=$2

  if [ "$token_address" == "null" ]; then
    echo "0" # Return 0 balance for null token addresses
    return 0
  fi

  local response=$(curl -s -H "Authorization: Bearer $access_token" \
    -H "Content-Type: application/json" \
    "https://node1.mercata-testnet2.blockapps.net/cirrus/search/BlockApps-Mercata-Asset?address=eq.$token_address&select=quantity")

  if ! echo "$response" | jq empty 2>/dev/null; then
    echo "Error: Non-JSON response for token $token_address."
    echo "0" # Return 0 balance in case of an error
    return 1
  fi

  echo "$response" | jq -r '.[0].quantity'
}

# Function to fetch previous reserves
fetch_previous_reserves() {
  local asset_root_address=$1
  local access_token=$2
  local new_reserve=$3

  local encoded_address=$(printf '%s' "$asset_root_address" | jq -sRr @uri)
  local response=$(curl -s -H "Authorization: Bearer $access_token" \
    -H "Content-Type: application/json" \
    "https://node1.mercata-testnet2.blockapps.net/cirrus/search/BlockApps-Mercata-Reserve?address=neq.$new_reserve&isActive=eq.true&creator=eq.BlockApps&assetRootAddress=eq.$encoded_address&select=address,stratsToken,cataToken")

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

# Function to migrate a reserve
migrate_reserve() {
  local prev_reserve=$1
  local new_reserve=$2
  local access_token=$3

  # Fetch escrows associated with the reserve
  local escrows_json=$(curl -s -H "Authorization: Bearer $access_token" \
    -H "Content-Type: application/json" \
    "https://node1.mercata-testnet2.blockapps.net/cirrus/search/BlockApps-Mercata-Escrow?reserve=eq.$prev_reserve&isActive=eq.true&creator=eq.BlockApps&select=address")

  if ! echo "$escrows_json" | jq empty 2>/dev/null; then
    echo "Error: Failed to fetch escrows for reserve $prev_reserve."
    return 1
  fi

  local escrows=$(echo "$escrows_json" | jq -c '[.[].address]')

  echo "Escrows for $prev_reserve: $escrows"

  # Call migrateReserve
  MIGRATE_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $access_token" \
    -d '{
      "txs": [{
        "payload": {
          "contractAddress": "'"$prev_reserve"'",
          "method": "migrateReserve",
          "args": {
            "_newReserve": "'"$new_reserve"'",
            "_escrows": '"$escrows"'
          }
        },
        "type": "FUNCTION"
      }],
      "txParams": {
        "gasLimit": 10000000000,
        "gasPrice": 1
      }
    }')

  if [ "$(echo "$MIGRATE_RESULT" | jq -r '.[0].status')" != "Success" ]; then
    echo "Error: Failed to migrate reserve $prev_reserve."
    exit 1
  fi
  echo "Reserve $prev_reserve migrated to $new_reserve."
}

# Function to deactivate a reserve
deactivate_reserve() {
  local prev_reserve=$1
  local new_reserve=$2
  local access_token=$3
  local strats_token=$4
  local cata_token=$5

  echo "Deactivating reserve $prev_reserve and transferring to $new_reserve..."

  # Transfer STRATS
  if [ "$strats_token" != "null" ] && [ "$strats_token" -gt 0 ]; then
    echo "Transferring STRATS..."
    NEW_STRATS_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $access_token" \
      -d '{
        "txs": [{
          "payload": {
            "contractAddress": "'"$prev_reserve"'",
            "method": "transferSTRATStoAnotherReserve",
            "args": {
              "_newOwner": "'"$new_reserve"'",
              "_amount": '"$strats_token"'
            }
          },
          "type": "FUNCTION"
        }],
        "txParams": {
          "gasLimit": 10000000000,
          "gasPrice": 1
        }
      }')
    NEW_STRATS_ADDRESS=$(echo $NEW_STRATS_RESULT | jq -r '.[0].txResult.contractsCreated')

    echo "NEW_STRATS_ADDRESS: $NEW_STRATS_ADDRESS"

    echo "Updating reserve token addresses..."
    UPDATE_STRATS_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $access_token" \
      -d '{"txs":[{"payload":{"contractAddress":"'"$new_reserve"'","method":"setStratsToken","args":{"_newStratsToken":"'"$NEW_STRATS_ADDRESS"'"}},"type":"FUNCTION"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}')
    
    if [ "$(echo "$UPDATE_STRATS_RESULT" | jq -r '.[0].status')" != "Success" ]; then
      echo "Error: Failed to update STRATS token address for reserve $new_reserve."
      exit 1
    fi
    echo "New reserve strat token updated."
  else
    echo "No STRATS token to transfer for reserve $prev_reserve."
  fi

  # Transfer CATA
  if [[ "$cata_token" =~ ^[0-9]+$ ]] && echo "$cata_token > 0" | bc -l; then
    echo "Transferring CATA..."
    NEW_CATA_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $access_token" \
      -d '{
        "txs": [{
          "payload": {
            "contractAddress": "'"$prev_reserve"'",
            "method": "transferCATAtoAnotherReserve",
            "args": {
              "_newOwner": "'"$new_reserve"'",
              "_amount": '"$cata_token"'
            }
          },
          "type": "FUNCTION"
        }],
        "txParams": {
          "gasLimit": 10000000000,
          "gasPrice": 1
        }
      }')

    NEW_CATA_ADDRESS=$(echo $NEW_CATA_RESULT | jq -r '.[0].txResult.contractsCreated')

    echo "NEW_CATA_ADDRESS: $NEW_CATA_ADDRESS"

    UPDATE_CATA_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $access_token" \
      -d '{"txs":[{"payload":{"contractAddress":"'"$new_reserve"'","method":"setCataToken","args":{"_newCataToken":"'"$NEW_CATA_ADDRESS"'"}},"type":"FUNCTION"}],"txParams":{"gasLimit":10000000000,"gasPrice":1}}')

    if [ "$(echo "$UPDATE_CATA_RESULT" | jq -r '.[0].status')" != "Success" ]; then
      echo "Error: Failed to update STRATS token address for reserve $new_reserve."
      exit 1
    fi
    echo "New reserve cata token updated."
  else
    echo "No CATA token to transfer for reserve $prev_reserve."
  fi

  # Migrate Reserve
  echo "Migrating reserve $prev_reserve to $new_reserve..."
  migrate_reserve "$prev_reserve" "$new_reserve" "$access_token"

  # Deactivate Reserve
  echo "Deactivating old reserve $prev_reserve..."
  DEACTIVATE_RESERVE_RESULT=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $access_token" \
    -d '{
      "txs": [{
        "payload": {
          "contractAddress": "'"$prev_reserve"'",
          "method": "deactivate",
          "args": {}
        },
        "type": "FUNCTION"
      }],
      "txParams": {
        "gasLimit": 10000000000,
        "gasPrice": 1
      }
    }')
  if [ "$(echo "$DEACTIVATE_RESERVE_RESULT" | jq -r '.[0].status')" != "Success" ]; then
    echo "Error: Failed to deactivate reserve $new_reserve."
    exit 1
  fi
  echo "Reserve $prev_reserve deactivated."
}

# Function to deploy a reserve and handle old reserves
deploy_reserve() {
  local asset_root_address=$1
  local name=$2
  local asset_oracle_address=$3
  local unit_conversion_rate=$4
  local access_token=$5

  echo "Deploying new reserve for $name..."

  SIMPLE_RESERVE_OUTPUT=$(ASSET_ROOT_ADDRESS="$asset_root_address" NAME="$name" ASSET_ORACLE_ADDRESS="$asset_oracle_address" UNIT_CONVERSION_RATE="$unit_conversion_rate" SKIP_TOKENS="true" ./deployReserves.sh)

  SIMPLE_RESERVE_ADDRESS=$(echo "$SIMPLE_RESERVE_OUTPUT" | grep -oE "contract deployed at address: [^ ]+" | awk '{print $NF}')

  if [ -z "$SIMPLE_RESERVE_ADDRESS" ]; then
    echo "Error: Failed to extract the deployed contract address from the deployment script output."
    exit 1
  fi

  echo "Deployed $name at address: $SIMPLE_RESERVE_ADDRESS"

  # Fetch previous reserves
  local reserves_json=$(fetch_previous_reserves "$asset_root_address" "$access_token" "$SIMPLE_RESERVE_ADDRESS")
  if [ $? -ne 0 ]; then
    echo "No previous reserves to handle for $name."
    return 0
  fi

  echo "$reserves_json" | jq -c '.[]' | while read -r reserve; do
    local reserve_address=$(echo "$reserve" | jq -r '.address')
    local strats_token=$(echo "$reserve" | jq -r '.stratsToken')
    local cata_token=$(echo "$reserve" | jq -r '.cataToken')

    echo "Processing Reserve: $reserve_address"

    local strats_balance=$(fetch_token_balance "$strats_token" "$access_token")
    local cata_balance=$(fetch_token_balance "$cata_token" "$access_token")

    echo "STRATS Balance: $strats_balance"
    echo "CATA Balance: $cata_balance"

    deactivate_reserve "$reserve_address" "$SIMPLE_RESERVE_ADDRESS" "$access_token" "$strats_balance" "$cata_balance"
  done
}

# Main Execution
USERNAME="blockapps"
PASSWORD="Bl0ck@pps"

ACCESS_TOKEN=$(get_access_token "$USERNAME" "$PASSWORD")
echo "Successfully fetched access token."

deploy_reserve "8e07e5a157982e3a8db4491f674632a750e863fe" "Silver" "dbd6851cb62254c8ba96d03702cc1eb6426783d9" 1.0 "$ACCESS_TOKEN"
deploy_reserve "41e97a61f035172b9ee0a2bc8d0b3436ba7954cb" "Gold Ounce" "ab5a6bc0132650b9d5d0b7176f02e491a10eed7a" 1.0 "$ACCESS_TOKEN"
deploy_reserve "e0de5687060d9a70cc3e4979cffa36e4660bc5b2" "Gold Gram" "ab5a6bc0132650b9d5d0b7176f02e491a10eed7a" 28.3495 "$ACCESS_TOKEN"