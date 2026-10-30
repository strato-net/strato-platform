# The node config can arrive as a base64 environment value instead of a
# mounted file (ECS has no bind mounts): ETHCONF_BASE64 is decoded to a
# private copy and used from there.
ETHCONF_FILE=${ETHCONF_FILE:-/config/ethconf.yaml}
if [ -n "${ETHCONF_BASE64:-}" ]; then
  ETHCONF_FILE=/tmp/ethconf.yaml
  echo "$ETHCONF_BASE64" | base64 -d > "$ETHCONF_FILE"
fi
# All config derived from ethconf.yaml (single source of truth)
STRATO_HOSTNAME=host.docker.internal  # host-side STRATO processes, aliased by docker-compose
STRATO_PORT_API=$(yq '.apiConfig.apiPort' "$ETHCONF_FILE")

# Resolve hostname to IPv4 via /etc/hosts to avoid IPv6 connection failures in Docker.
# Docker host-gateway maps to both IPv6 and IPv4; nginx uses `resolver ipv6=off` but
# Node.js has no equivalent, so we resolve to the IPv4 address here.
STRATO_IPV4=$(grep -w "$STRATO_HOSTNAME" /etc/hosts 2>/dev/null | grep -v ':' | awk '{print $1}' | head -1)
if [ -n "$STRATO_IPV4" ]; then
  STRATO_HOSTNAME="$STRATO_IPV4"
fi

# Opt-in: where strato-api runs next to apex rather than on the docker host
# (an API tier task: APEX_STRATO_API_HOST=127.0.0.1). Unset everywhere else, so
# the host alias stays the source as above.
if [ -n "${APEX_STRATO_API_HOST:-}" ]; then
  STRATO_HOSTNAME="$APEX_STRATO_API_HOST"
  STRATO_PORT_API="${APEX_STRATO_API_PORT:-$STRATO_PORT_API}"
fi

export STRATO_HOSTNAME
export STRATO_PORT_API
# strato-p2p's own API, the source of /health's peer list: the fixed port
# Prometheus scrapes its metrics from, next to strato-api on the same host.
export STRATO_PORT_P2P_API=${STRATO_PORT_P2P_API:-10248}
export STRATO_PORT_VAULT_PROXY=${STRATO_PORT_VAULT_PROXY:-8013}
export stratoRoot=${stratoRoot:-http://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2}
export vaultUrl=$(yq '.urlConfig.vaultUrl' "$ETHCONF_FILE")
# The Redis block cache the node's processes use (--redisHost, --redisPort,
# --redisDBNumber). localhost:6379 is the bundled redis container, which this
# container reaches by its service name; a host-local address on another port
# is a Redis running on the docker host, reached through the host gateway
# like strato-api; anything else is an external Redis, reached as configured.
# An explicit redis_host (an API-tier task) wins.
if [ -z "${redis_host:-}" ]; then
  _redis_host=$(yq '.redisBlockDBConfig.redisHost' "$ETHCONF_FILE")
  _redis_port=$(yq '.redisBlockDBConfig.redisPort' "$ETHCONF_FILE")
  case "$_redis_port" in null|"") _redis_port=6379 ;; esac
  case "$_redis_host" in
    localhost|127.0.0.1|::1|null|"")
      if [ "$_redis_port" = "6379" ]; then
        redis_host=redis
      else
        redis_host="$STRATO_HOSTNAME"
      fi ;;
    *) redis_host="$_redis_host" ;;
  esac
  redis_port="$_redis_port"
fi
export redis_host
export redis_port=${redis_port:-6379}
export redis_db_number=$(yq '.redisBlockDBConfig.redisDBNumber' "$ETHCONF_FILE")
