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
#   postgres_host, postgres_port, postgres_user   writer endpoint (host required)
#   postgres_reader_host                          replica endpoint for reads
#   ETHCONF_BASE64                                the node config, when not mounted
#   INGRESS_URLS (required)                       the core cells' transaction ingress
#                                                 (strato-ingest), comma-separated;
#                                                 a batch is posted to every one
#   VM_QUERY (default true), VM_QUERY_URLS        this copy's vm-query, and other
#                                                 copies' to try when it is down
#   postgres_password | /run/secrets/postgres_password
#   VAULT_URL                                     vault-wrapper base URL
#   OAUTH_CREDENTIALS_YAML | /run/secrets/oauth_credentials.yaml
#     | OAUTH_DISCOVERY_URL + OAUTH_CLIENT_ID + OAUTH_CLIENT_SECRET
#   API_LISTEN_ADDRESS                            default 0.0.0.0 (container-internal;
#                                                 only nginx can reach the ports).
#                                                 ethereum-jsonrpc binds it too.
set -e

Green='\033[0;32m'
NC='\033[0m'

: ${STRATO_API_DIR:=/var/lib/strato-api}
: ${API_LISTEN_ADDRESS:=0.0.0.0}

# The node config can arrive as a base64 environment value instead of a
# mounted file (ECS has no bind mounts): ETHCONF_BASE64 is decoded to a
# private copy and used from there.
ETHCONF_FILE=${ETHCONF_FILE:-/config/ethconf.yaml}
if [[ -n "${ETHCONF_BASE64:-}" ]]; then
  ETHCONF_FILE=/tmp/ethconf.yaml
  echo "$ETHCONF_BASE64" | base64 -d > "$ETHCONF_FILE"
fi
if [[ ! -f "$ETHCONF_FILE" ]]; then
  echo "api-doit.sh: $ETHCONF_FILE is required (mount a node's ethconf.yaml or set ETHCONF_BASE64)" >&2
  exit 7
fi

mkdir -p "$STRATO_API_DIR/secrets" "$STRATO_API_DIR/logs"
cd "$STRATO_API_DIR"

CONF="$STRATO_API_DIR/ethconf.yaml"
cp "$ETHCONF_FILE" "$CONF"

if [[ -z "${postgres_password:-}" && -f /run/secrets/postgres_password ]]; then
  postgres_password=$(tr -d '[:space:]' < /run/secrets/postgres_password)
fi

# Endpoint overrides. Anything unset keeps the mounted config's value.
override() {
  local path=$1 value=$2
  # strenv: the value is read from the environment, so quotes and
  # backslashes in a secret are not interpolated into the expression
  [[ -n "$value" ]] && OVERRIDE_VALUE="$value" yq -i "$path = strenv(OVERRIDE_VALUE)" "$CONF"
  return 0
}
override_num() {
  local path=$1 value=$2
  [[ -n "$value" ]] && yq -i "$path = $value" "$CONF"
  return 0
}
override     '.sqlConfig.host'                 "${postgres_host:-}"
override     '.cirrusConfig.host'              "${postgres_reader_host:-${postgres_host:-}}"
override_num '.sqlConfig.port'                 "${postgres_port:-}"
override_num '.cirrusConfig.port'              "${postgres_port:-}"
override     '.sqlConfig.user'                 "${postgres_user:-}"
override     '.cirrusConfig.user'              "${postgres_user:-}"
override     '.sqlConfig.password'             "${postgres_password:-}"
override     '.cirrusConfig.password'          "${postgres_password:-}"
override     '.urlConfig.vaultUrl'             "${VAULT_URL:-}"
# Submitted transactions go to every core cell's ingress (strato-ingest);
# this tier runs no sequencer and never writes a stream of its own.
if [[ -z "${INGRESS_URLS:-}" ]]; then
  echo "api-doit.sh: INGRESS_URLS is required (comma-separated http://<cell>:8600 of every core cell)" >&2
  exit 8
fi
INGRESS_LIST="$INGRESS_URLS" yq -i '.ingressUrls = (strenv(INGRESS_LIST) | split(",") | map(trim) | map(select(. != "")))' "$CONF"
# General eth reads go to the replica endpoint; writes and the resolve poll
# stay on the writer (see Blockchain.DB.SQLDB).
if [[ -n "${postgres_reader_host:-}" ]]; then
  yq -i '.sqlReaderConfig = .sqlConfig' "$CONF"
  override   '.sqlReaderConfig.host'           "$postgres_reader_host"
fi
override     '.apiConfig.apiListenAddress'     "$API_LISTEN_ADDRESS"
# ethereum-jsonrpc binds apiListenAddress as well, and bloc reaches it in this
# same container on loopback for simulations (strato-api derives the URL).
# vm-query (phase 5): calls, simulations and call traces are served from
# the SQL mirror by this container's own instance (VM_QUERY=true, the
# default) and, when it cannot be reached, by the other copies' instances at
# VM_QUERY_URLS. This tier has no consensus VM: what the mirror cannot serve
# is answered with an error, never forwarded to a core (vmQueryOnly).
VM_QUERY_LIST=""
if [[ "${VM_QUERY:-true}" == "true" ]]; then
  VM_QUERY_LIST="http://127.0.0.1:8546"
fi
if [[ -n "${VM_QUERY_URLS:-}" ]]; then
  VM_QUERY_LIST="${VM_QUERY_LIST:+$VM_QUERY_LIST,}$VM_QUERY_URLS"
fi
if [[ -z "$VM_QUERY_LIST" ]]; then
  echo "api-doit.sh: no vm-query instance (VM_QUERY=false and VM_QUERY_URLS empty); the API tier cannot serve eth_call without one" >&2
  exit 9
fi
yq -i '.vmConfig.vmQueryUrl = null' "$CONF"
VM_QUERY_LIST="$VM_QUERY_LIST" yq -i '.vmConfig.vmQueryUrls = (strenv(VM_QUERY_LIST) | split(",") | map(trim) | map(select(. != "")))' "$CONF"
yq -i '.vmConfig.vmQueryOnly = true' "$CONF"
export STRATO_CONF="$CONF"

# OAuth client credentials for strato-api's service-to-service calls: a
# mounted file, the file's contents in OAUTH_CREDENTIALS_YAML (how ECS hands
# over a Secrets Manager value), or the three OAUTH_* variables.
if [[ -n "${OAUTH_CREDENTIALS_YAML:-}" ]]; then
  printf '%s\n' "$OAUTH_CREDENTIALS_YAML" > secrets/oauth_credentials.yaml
elif [[ -f /run/secrets/oauth_credentials.yaml ]]; then
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
if [[ "${VM_QUERY:-true}" == "true" ]]; then
  echo "@restart vm-query serve +RTS -T -N -maxN4 -RTS" >> commands.txt
fi

echo -e "${Green}Starting API tier processes via convoke...${NC}"
exec convoke --no-docker
