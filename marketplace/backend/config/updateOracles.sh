#!/bin/bash

USERNAME=""
PASSWORD=""
SILVER_ORACLE_ADDRESS=""
GOLD_ORACLE_ADDRESS=""  
ETH_ORACLE_ADDRESS=""
USD_ORACLE_ADDRESS=""

# Function to get access token
get_access_token() {
  local username=$1
  local password=$2

  local access_token=$(curl -L -X POST "" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -H 'Authorization:' \
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

# Function to fetch active reserves
fetch_active_reserves() {
  local access_token=$1

  local response=$(curl -s -H "Authorization: Bearer $access_token" \
    -H "Content-Type: application/json" \
    "https://marketplace.mercata-testnet2.blockapps.net/cirrus/search/BlockApps-Mercata-Reserve?isActive=eq.true&creator=eq.BlockApps")

  if ! echo "$response" | jq empty 2>/dev/null; then
    echo "Error: Non-JSON response."
    exit 1
  fi

  echo "$response"
}

# Function to update oracle address for a reserve
update_oracle() {
  local reserve_address=$1
  local new_oracle_address=$2
  local access_token=$3

  local update_result=$(curl -X POST "https://node1.mercata-testnet2.blockapps.net/bloc/v2.2/transaction?resolve=true" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $access_token" \
    -d '{
      "txs": [{
        "payload": {
          "contractAddress": "'"$reserve_address"'",
          "method": "setOracle",
          "args": {
            "_newOracle": "'"$new_oracle_address"'"
          }
        },
        "type": "FUNCTION"
      }],
      "txParams": {
        "gasLimit": 10000000000,
        "gasPrice": 1
      }
    }')

  if [ "$(echo "$update_result" | jq -r '.[0].status')" != "Success" ]; then
    echo "Error: Failed to update oracle for reserve $reserve_address."
    exit 1
  fi
  echo "Oracle for reserve $reserve_address updated to $new_oracle_address."
}

# Main Execution
ACCESS_TOKEN=$(get_access_token "$USERNAME" "$PASSWORD")
echo "Successfully fetched access token."

# Fetch active reserves
active_reserves=$(fetch_active_reserves "$ACCESS_TOKEN")

# Parse and update oracles based on reserve names
echo "$active_reserves" | jq -c '.[]' | while read -r reserve; do
  reserve_address=$(echo "$reserve" | jq -r '.address')
  reserve_name=$(echo "$reserve" | jq -r '.name')

  case "$reserve_name" in
    "Silver")
      update_oracle "$reserve_address" "$SILVER_ORACLE_ADDRESS" "$ACCESS_TOKEN"
      ;;
    "Gold Ounce")
      update_oracle "$reserve_address" "$GOLD_ORACLE_ADDRESS" "$ACCESS_TOKEN"
      ;;
    "Gold Gram")
      update_oracle "$reserve_address" "$GOLD_ORACLE_ADDRESS" "$ACCESS_TOKEN"
      ;;
    "ETHST")
      update_oracle "$reserve_address" "$ETH_ORACLE_ADDRESS" "$ACCESS_TOKEN"
      ;;
    "USDT")
      update_oracle "$reserve_address" "$USD_ORACLE_ADDRESS" "$ACCESS_TOKEN"
      ;;
    "BETHTEMP")
      update_oracle "$reserve_address" "$ETH_ORACLE_ADDRESS" "$ACCESS_TOKEN"
      ;;
    "USDTEMP")
      update_oracle "$reserve_address" "$USD_ORACLE_ADDRESS" "$ACCESS_TOKEN"
      ;;
    *)
      echo "No oracle update needed for reserve $reserve_name."
      ;;
  esac
done 