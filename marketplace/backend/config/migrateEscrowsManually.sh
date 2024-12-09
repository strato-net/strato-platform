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
    }')function 

  if [ "$(echo "$MIGRATE_RESULT" | jq -r '.[0].status')" != "Success" ]; then
    echo "Error: Failed to migrate reserve $prev_reserve."
    exit 1
  fi
  echo "Reserve $prev_reserve migrated to $new_reserve."
}