# All config derived from ethconf.yaml (single source of truth)
NODE_URL=$(yq '.urlConfig.nodeUrl' /config/ethconf.yaml)
STRATO_HOSTNAME=$(echo "$NODE_URL" | sed 's|https\?://\([^:/]*\).*|\1|')
STRATO_PORT_API=$(yq '.apiConfig.apiPort' /config/ethconf.yaml)

export STRATO_HOSTNAME
export STRATO_PORT_API
export STRATO_PORT_VAULT_PROXY=${STRATO_PORT_VAULT_PROXY:-8013}
export stratoRoot=${stratoRoot:-http://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2}
export vaultUrl=$(yq '.urlConfig.vaultUrl' /config/ethconf.yaml)
