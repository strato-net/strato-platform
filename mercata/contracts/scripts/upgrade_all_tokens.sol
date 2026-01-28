#!/bin/bash

# Required ENV Vars:
# - OAUTH_CLIENT_SECRET
# - OAUTH_CLIENT_ID
# - NODE_URL
# Optional ENV Vars:
# - TOKEN_ENDPOINT
# - TOKEN_FACTORY_PROXY_ADDRESS

set -e

# Load .env file
set -a
[ -f .env ] && source .env
set +a

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

echo npm run upgrade -- --proxy-address "${TOKEN_FACTORY_PROXY_ADDRESS}" --contract-name "TokenFactory" --contract-file "BaseCodeCollection.sol"
npm run upgrade -- --proxy-address "${TOKEN_FACTORY_PROXY_ADDRESS}" --contract-name "TokenFactory" --contract-file "BaseCodeCollection.sol"
i=0
for tokenproxy in $(cat .listone); do
  i=$((i+1))
  echo "Upgrading token: ${token} (${i}/${tokencount})"
  echo npm run upgrade -- --proxy-address "${tokenproxy}" --contract-name "Token" --contract-file "BaseCodeCollection.sol"
  npm run upgrade -- --proxy-address "${tokenproxy}" --contract-name "Token" --contract-file "BaseCodeCollection.sol"
done

rm .listone .listtwo