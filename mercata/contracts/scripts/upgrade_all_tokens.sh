#!/bin/bash

# Usage: scripts/upgrade_all_tokens.sh
# Required ENV Vars:
# - OAUTH_CLIENT_SECRET
# - OAUTH_CLIENT_ID
# - NODE_URL
# Optional ENV Vars:
# - TOKEN_ENDPOINT
# - TOKEN_FACTORY_PROXY_ADDRESS
# - DRY_RUN
# Additionally, configure your .env file for the `upgrade.js` script.

set -e

source .env

TOKEN_ENDPOINT="${TOKEN_ENDPOINT:-https://keycloak.blockapps.net/auth/realms/mercata/protocol/openid-connect/token}"

TOKEN_FACTORY_PROXY_ADDRESS="${TOKEN_FACTORY_PROXY_ADDRESS:-000000000000000000000000000000000000100b}"
BLOC_QUERY="${NODE_URL}/bloc/v2.2/contracts/BlockApps-TokenFactory/${TOKEN_FACTORY_PROXY_ADDRESS}/state"

echo "TOKEN_ENDPOINT: ${TOKEN_ENDPOINT}"
echo "TOKEN_FACTORY_PROXY_ADDRESS: ${TOKEN_FACTORY_PROXY_ADDRESS}"
echo "BLOC_QUERY: ${BLOC_QUERY}"

# Get token and fetch contract state
TOKEN=$(curl -s -X POST "${TOKEN_ENDPOINT}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n "${OAUTH_CLIENT_ID}:${OAUTH_CLIENT_SECRET}" | base64 -w 0)" \
  --data-urlencode "grant_type=client_credentials" | jq -r '.access_token')

curl -s -X GET \
  "${BLOC_QUERY}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/json" | jq -r '.isFactoryToken | keys' | sed 's/[][,"]//g' | grep -v '^$' | sort > .listone

curl -s -X GET \
  "${BLOC_QUERY}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/json" | jq -r '.allTokens' | sed 's/[][,"]//g' | grep -v '^$' | sort > .listtwo

if [ "$(md5sum .listone | awk '{print $1}')" != "$(md5sum .listtwo | awk '{print $1}')" ]; then
  echo "ALERT: TokenFactory.isFactoryToken does not match TokenFactory.allTokens"
  exit 1
fi

tokencount=$(wc -l .listone | awk '{print $1}')
echo "${tokencount} tokens found"

read -n 1 -p "Ready to upgrade all tokens? (DRY_RUN: ${DRY_RUN:-false}) (y/n): " choice
if [ "$choice" != "y" ]; then
  echo "Exiting..."
  # don't delete .listone or .listtwo; maybe the user is stopping here to check them
  exit 1
fi

echo npm run upgrade -- --proxy-address "${TOKEN_FACTORY_PROXY_ADDRESS}" --contract-name "TokenFactory" --contract-file "BaseCodeCollection.sol"
if [ -z "$DRY_RUN" ]; then
  npm run upgrade -- --proxy-address "${TOKEN_FACTORY_PROXY_ADDRESS}" --contract-name "TokenFactory" --contract-file "BaseCodeCollection.sol"
fi
i=0
for tokenproxy in $(cat .listone); do
  i=$((i+1))
  echo "Upgrading token: ${token} (${i}/${tokencount})"
  echo npm run upgrade -- --proxy-address "${tokenproxy}" --contract-name "Token" --contract-file "BaseCodeCollection.sol"
  if [ -z "$DRY_RUN" ]; then
    npm run upgrade -- --proxy-address "${tokenproxy}" --contract-name "Token" --contract-file "BaseCodeCollection.sol"
  fi
done

rm .listone .listtwo