#!/bin/bash
# Entrypoint for the API tier (docker-compose.api.yml): strato-api and
# ethereum-jsonrpc from the strato image, with nginx as a sidecar container.
#
# Config: a node's ethconf.yaml mounted at /config/ethconf.yaml supplies the
# network parameters (chain id, gas limit, vault URL, ...). The endpoints the
# API tier must reach are overridden from the environment below, and the
# result is written to $STRATO_API_DIR/ethconf.yaml and pointed at through
# STRATO_CONF, so nothing here depends on the working-directory convention.
#
# Environment (all optional unless noted):
#   postgres_host, postgres_port, postgres_user   writer/reader endpoint for
#                                                 eth + cirrus (host required)
#   postgres_password | /run/secrets/postgres_password
#   kafkaHost, kafkaPort                          broker for tx submission
#   EDGE_REDIS_HOST, EDGE_REDIS_PORT              nonce counters
#   VAULT_URL                                     vault-wrapper base URL
#   OAUTH_DISCOVERY_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET
#                                                 or /run/secrets/oauth_credentials.yaml
#   API_LISTEN_ADDRESS, RPC_LISTEN_ADDRESS        default 0.0.0.0 (container-internal;
#                                                 only nginx can reach the ports)
set -e

Green='\033[0;32m'
NC='\033[0m'

: ${STRATO_API_DIR:=/var/lib/strato-api}
: ${API_LISTEN_ADDRESS:=0.0.0.0}
: ${RPC_LISTEN_ADDRESS:=0.0.0.0}

if [[ ! -f /config/ethconf.yaml ]]; then
  echo "api-doit.sh: /config/ethconf.yaml is required (mount a node's ethconf.yaml)" >&2
  exit 7
fi

mkdir -p "$STRATO_API_DIR/secrets" "$STRATO_API_DIR/logs"
cd "$STRATO_API_DIR"

CONF="$STRATO_API_DIR/ethconf.yaml"
cp /config/ethconf.yaml "$CONF"

if [[ -z "${postgres_password:-}" && -f /run/secrets/postgres_password ]]; then
  postgres_password=$(tr -d '[:space:]' < /run/secrets/postgres_password)
fi

# Endpoint overrides. Anything unset keeps the mounted config's value.
override() {
  local path=$1 value=$2
  [[ -n "$value" ]] && yq -i "$path = \"$value\"" "$CONF"
}
override_num() {
  local path=$1 value=$2
  [[ -n "$value" ]] && yq -i "$path = $value" "$CONF"
}
override     '.sqlConfig.host'                 "${postgres_host:-}"
override     '.cirrusConfig.host'              "${postgres_host:-}"
override_num '.sqlConfig.port'                 "${postgres_port:-}"
override_num '.cirrusConfig.port'              "${postgres_port:-}"
override     '.sqlConfig.user'                 "${postgres_user:-}"
override     '.cirrusConfig.user'              "${postgres_user:-}"
override     '.sqlConfig.password'             "${postgres_password:-}"
override     '.cirrusConfig.password'          "${postgres_password:-}"
override     '.streamingConfig.streamingHost'  "${kafkaHost:-}"
override_num '.streamingConfig.streamingPort'  "${kafkaPort:-}"
override     '.edgeRedisConfig.redisHost'      "${EDGE_REDIS_HOST:-}"
override_num '.edgeRedisConfig.redisPort'      "${EDGE_REDIS_PORT:-}"
override     '.urlConfig.vaultUrl'             "${VAULT_URL:-}"
override     '.apiConfig.apiListenAddress'     "$API_LISTEN_ADDRESS"
override     '.apiConfig.rpcListenAddress'     "$RPC_LISTEN_ADDRESS"
# bloc reaches the JSON-RPC server in this same container for simulations.
override     '.vmConfig.vmJsonRpcUrl'          "http://127.0.0.1:8545"
export STRATO_CONF="$CONF"

# OAuth client credentials for strato-api's service-to-service calls.
if [[ -f /run/secrets/oauth_credentials.yaml ]]; then
  cp /run/secrets/oauth_credentials.yaml secrets/oauth_credentials.yaml
elif [[ -n ${OAUTH_CLIENT_ID:-} && -n ${OAUTH_CLIENT_SECRET:-} ]]; then
  cat > secrets/oauth_credentials.yaml << EOC
discoveryUrl: "${OAUTH_DISCOVERY_URL:-https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration}"
clientId: "${OAUTH_CLIENT_ID}"
clientSecret: "${OAUTH_CLIENT_SECRET}"
EOC
else
  echo "api-doit.sh: OAuth client credentials are required (OAUTH_CLIENT_ID/OAUTH_CLIENT_SECRET or /run/secrets/oauth_credentials.yaml)" >&2
  exit 7
fi
export STRATO_OAUTH_CREDENTIALS="$STRATO_API_DIR/secrets/oauth_credentials.yaml"

PG_HOST=$(yq '.sqlConfig.host' "$CONF")
PG_PORT=$(yq '.sqlConfig.port' "$CONF")
PG_USER=$(yq '.sqlConfig.user' "$CONF")
echo 'Waiting for Postgres to be available...'
until pg_isready -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" > /dev/null 2>&1; do
  sleep 0.5
done
echo 'Postgres is available'

cat > commands.txt << EOC
strato-api +RTS -T -N -maxN4 -RTS
ethereum-jsonrpc +RTS -T -N -maxN4 -RTS
EOC

echo -e "${Green}Starting API tier processes via convoke...${NC}"
exec convoke --no-docker
