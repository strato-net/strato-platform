# The node config can arrive as a base64 environment value instead of a
# mounted file (ECS has no bind mounts): ETHCONF_BASE64 is decoded to a
# private copy and used from there.
ETHCONF_FILE=${ETHCONF_FILE:-/config/ethconf.yaml}
if [ -n "${ETHCONF_BASE64:-}" ]; then
  ETHCONF_FILE=/tmp/ethconf.yaml
  echo "$ETHCONF_BASE64" | base64 -d > "$ETHCONF_FILE"
fi
# All config derived from ethconf.yaml (single source of truth)
NODE_URL=$(yq '.urlConfig.nodeUrl' "$ETHCONF_FILE")
STRATO_HOSTNAME=$(echo "$NODE_URL" | sed 's|https\?://\([^:/]*\).*|\1|')
STRATO_PORT_API=$(yq '.apiConfig.apiPort' "$ETHCONF_FILE")

# Resolve hostname to IPv4 via /etc/hosts to avoid IPv6 connection failures in Docker.
# Docker host-gateway maps to both IPv6 and IPv4; nginx uses `resolver ipv6=off` but
# Node.js has no equivalent, so we resolve to the IPv4 address here.
STRATO_IPV4=$(grep -w "$STRATO_HOSTNAME" /etc/hosts 2>/dev/null | grep -v ':' | awk '{print $1}' | head -1)
if [ -n "$STRATO_IPV4" ]; then
  STRATO_HOSTNAME="$STRATO_IPV4"
fi

# Opt-in: where strato-api runs next to apex rather than at the node URL's host
# (an API tier task: APEX_STRATO_API_HOST=127.0.0.1). Unset everywhere else, so
# the node URL stays the source as above.
if [ -n "${APEX_STRATO_API_HOST:-}" ]; then
  STRATO_HOSTNAME="$APEX_STRATO_API_HOST"
  STRATO_PORT_API="${APEX_STRATO_API_PORT:-$STRATO_PORT_API}"
fi

export STRATO_HOSTNAME
export STRATO_PORT_API
export STRATO_PORT_VAULT_PROXY=${STRATO_PORT_VAULT_PROXY:-8013}
export stratoRoot=${stratoRoot:-http://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2}
export vaultUrl=$(yq '.urlConfig.vaultUrl' "$ETHCONF_FILE")
