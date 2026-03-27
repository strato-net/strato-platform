# exported values are accessible in the app via process.env[]
# stratoRoot uses direct connection to strato-api for internal calls
export stratoRoot=${stratoRoot:-http://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2}
# vaultUrl read from ethconf.yaml (the canonical source of truth)
export vaultUrl=$(yq '.urlConfig.vaultUrl' /config/ethconf.yaml)
