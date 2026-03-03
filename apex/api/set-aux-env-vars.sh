# exported values are accessible in the app via process.env[]
# stratoRoot uses direct connection to strato-api for internal calls
export stratoRoot=${stratoRoot:-http://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2}
# vaultUrl goes through nginx which routes to vault-proxy
export vaultUrl=${vaultUrl:-http://nginx}
