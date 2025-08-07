#!/bin/bash

log_file="$(date +%Y%m%d%H%M%S).log"

# Source configuration file
CONFIG_FILE="./config.sh"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Configuration file $CONFIG_FILE not found"
    exit 1
fi

source "$CONFIG_FILE"

# Ask for password
echo -n "Enter password for $USERNAME: "
read -s PASSWORD
echo

# Display pairs for user review
echo "Review the following oracle-reserve pairs:"
echo "----------------------------------------"
echo "1. SILVER: $SILVER_ORACLE_ADDRESS -> $SILVER_RESERVE_ADDRESS"
echo "2. GOLD OUNCE: $GOLD_ORACLE_ADDRESS -> $GOLD_OUNCE_RESERVE_ADDRESS"
echo "3. GOLD GRAM: $GOLD_ORACLE_ADDRESS -> $GOLD_GRAM_RESERVE_ADDRESS"
echo "4. BETHTEMP: $ETH_ORACLE_ADDRESS -> $BETHTEMP_RESERVE_ADDRESS"
echo "5. ETHST: $ETH_ORACLE_ADDRESS -> $ETHST_RESERVE_ADDRESS"
echo "6. WBTCST: $BTC_ORACLE_ADDRESS -> $WBTCST_RESERVE_ADDRESS"
echo "7. GOLDST: $GOLDST_ORACLE_ADDRESS -> $GOLDST_RESERVE_ADDRESS"
echo "8. USDTEMP: $USD_ORACLE_ADDRESS -> $USDTEMP_RESERVE_ADDRESS"
echo "9. USDTST: $USDTST_ORACLE_ADDRESS -> $USDTST_RESERVE_ADDRESS"
echo "10. USDCST: $USDCST_ORACLE_ADDRESS -> $USDCST_RESERVE_ADDRESS"
echo "11. PAXGST: $PAXGST_ORACLE_ADDRESS -> $PAXGST_RESERVE_ADDRESS"
echo "----------------------------------------"

# Ask for confirmation
echo -n "Do you want to proceed with these pairs? (y/n): "
read confirmation

if [[ $confirmation != "y" && $confirmation != "Y" ]]; then
  echo "Aborted. Please edit the values in the bash script if needed."
  exit 1
fi


# Function to ask for confirmation before continuing
ask_to_continue() {
  echo -n "Review the output above; Press Enter to continue to the next update (or type 'q' to quit): "
  read continue_input

  if [[ "$continue_input" == "q" || "$continue_input" == "Q" ]]; then
    echo "Aborting remaining updates."
    exit 0
  fi
}

# Function to run update for a pair
run_update() {
  local oracle=$1
  local reserve=$2
  local name=$3
  echo "Updating $name..."
  USERNAME=$USERNAME PASSWORD=$PASSWORD ORACLE_ADDRESS=$oracle RESERVE_ADDRESS=$reserve node updateOracleOnReserve.js 2>&1 | tee -a "$log_file"

  # Check if the node command was successful
  if [ ${PIPESTATUS[0]} -ne 0 ]; then
    echo "ERROR: Update for $name failed! Check $log_file for details."
    echo "Do you want to continue with remaining updates? (y/n): "
    read continue_choice
    if [[ $continue_choice != "y" && $continue_choice != "Y" ]]; then
      echo "Aborted remaining updates."
      exit 1
    fi
  else
    echo "Update for $name completed successfully."
  fi
  echo "----------------------------------------"
}

# Run updates for each pair
run_update "$SILVER_ORACLE_ADDRESS" "$SILVER_RESERVE_ADDRESS" "SILVER"
ask_to_continue
run_update "$GOLD_ORACLE_ADDRESS" "$GOLD_OUNCE_RESERVE_ADDRESS" "GOLD_OUNCE"
ask_to_continue
run_update "$GOLD_ORACLE_ADDRESS" "$GOLD_GRAM_RESERVE_ADDRESS" "GOLD_GRAM"
ask_to_continue
run_update "$ETH_ORACLE_ADDRESS" "$BETHTEMP_RESERVE_ADDRESS" "BETHTEMP"
ask_to_continue
run_update "$ETH_ORACLE_ADDRESS" "$ETHST_RESERVE_ADDRESS" "ETHST"
ask_to_continue
run_update "$BTC_ORACLE_ADDRESS" "$WBTCST_RESERVE_ADDRESS" "WBTCST"
ask_to_continue
run_update "$GOLDST_ORACLE_ADDRESS" "$GOLDST_RESERVE_ADDRESS" "GOLDST"
ask_to_continue
run_update "$USD_ORACLE_ADDRESS" "$USDTEMP_RESERVE_ADDRESS" "USDTEMP"
ask_to_continue
run_update "$USDTST_ORACLE_ADDRESS" "$USDTST_RESERVE_ADDRESS" "USDTST"
ask_to_continue
run_update "$USDCST_ORACLE_ADDRESS" "$USDCST_RESERVE_ADDRESS" "USDCST"
ask_to_continue
run_update "$PAXGST_ORACLE_ADDRESS" "$PAXGST_RESERVE_ADDRESS" "PAXGST"

echo "All updates completed."
