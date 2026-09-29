# All config derived from ethconf.yaml (single source of truth)
STRATO_HOSTNAME=host.docker.internal  # host-side STRATO processes, aliased by docker-compose
STRATO_PORT_API=$(yq '.apiConfig.apiPort' /config/ethconf.yaml)

# Resolve hostname to IPv4 via /etc/hosts to avoid IPv6 connection failures in Docker.
# Docker host-gateway maps to both IPv6 and IPv4; nginx uses `resolver ipv6=off` but
# Node.js has no equivalent, so we resolve to the IPv4 address here.
STRATO_IPV4=$(grep -w "$STRATO_HOSTNAME" /etc/hosts 2>/dev/null | grep -v ':' | awk '{print $1}' | head -1)
if [ -n "$STRATO_IPV4" ]; then
  STRATO_HOSTNAME="$STRATO_IPV4"
fi

export STRATO_HOSTNAME
export STRATO_PORT_API
export STRATO_PORT_VAULT_PROXY=${STRATO_PORT_VAULT_PROXY:-8013}
export stratoRoot=${stratoRoot:-http://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2}
export vaultUrl=$(yq '.urlConfig.vaultUrl' /config/ethconf.yaml)
