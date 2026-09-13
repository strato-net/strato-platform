#!/bin/sh
set -e

# OpenID configuration: the node mounts secrets/oauth_credentials.yaml; the app
# tier (ECS) passes OAUTH_DISCOVERY_URL in the environment instead. Only the
# discovery URL is required (to verify logged-in users' tokens); the client id
# and secret are optional and only used for a service token on anonymous node
# calls and for the bridge deposit password grant.
if [ -f /run/secrets/oauth_credentials.yaml ]; then
  export OAUTH_DISCOVERY_URL=$(grep "discoveryUrl:" /run/secrets/oauth_credentials.yaml | cut -d'"' -f2)
  export OAUTH_CLIENT_ID=$(grep "clientId:" /run/secrets/oauth_credentials.yaml | cut -d'"' -f2)
  export OAUTH_CLIENT_SECRET=$(grep "clientSecret:" /run/secrets/oauth_credentials.yaml | cut -d'"' -f2)
elif [ -n "${OAUTH_DISCOVERY_URL:-}" ]; then
  if [ -n "${OAUTH_CLIENT_ID:-}" ] && [ -n "${OAUTH_CLIENT_SECRET:-}" ]; then
    echo "Using OpenID discovery URL and client credentials from the environment"
  else
    echo "Using OpenID discovery URL from the environment; no client credentials (anonymous node calls)"
  fi
else
  echo "ERROR: /run/secrets/oauth_credentials.yaml not found and OAUTH_DISCOVERY_URL not set."
  exit 1
fi

# The node to talk to: on a node, the bundled nginx (the node's ethconf says
# where strato-api listens); on the app tier there is no ethconf and NODE_URL
# names the API tier's load balancer, so everything goes through it.
if [ -f /config/ethconf.yaml ]; then
  STRATO_URL=$(yq '.urlConfig.nodeUrl' /config/ethconf.yaml)
  STRATO_HOSTNAME=$(echo "$STRATO_URL" | sed 's|https\?://\([^:/]*\).*|\1|')
  STRATO_PORT_API=$(yq '.apiConfig.apiPort' /config/ethconf.yaml)
  STRATO_API_URL="http://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2"
  export NODE_URL='http://nginx:8081'
else
  if [ -z "${NODE_URL:-}" ]; then
    echo "ERROR: no /config/ethconf.yaml and NODE_URL is not set."
    exit 1
  fi
  STRATO_API_URL="${NODE_URL%/}/strato-api/eth/v1.2"
  echo "No ethconf mounted: using NODE_URL=${NODE_URL} (API at ${STRATO_API_URL})"
fi

# Read Postgres password for direct DB queries
if [ -f /run/secrets/postgres_password ]; then
  export postgres_password=$(cat /run/secrets/postgres_password)
fi

echo "Waiting for STRATO node to finish syncing (checking ${STRATO_API_URL}/metadata for isSynced=true)..."
echo "  This may take a long time if the node is catching up with the network."
while true; do
  IS_SYNCED=$(wget -qO- --timeout=10 "${STRATO_API_URL}/metadata" 2>/dev/null | node -e "
    let d='';
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => {
      try {
        const m = JSON.parse(d);
        console.log(m.isSynced === true ? 'true' : 'false');
      } catch(e) {
        console.log('false');
      }
    });
  " 2>/dev/null || echo "false")

  if [ "${IS_SYNCED}" = "true" ]; then
    echo "STRATO node is fully synced!"
    break
  fi

  echo "  Node is still syncing. Will check again in 30s... ($(date))"
  sleep 30
done

echo "Starting app-backend..."
exec node dist/app.js
