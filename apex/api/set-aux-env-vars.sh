# exported values are accessible in the app via process.env[]
# stratoRoot uses direct connection to strato-api for internal calls
export stratoRoot=${stratoRoot:-http://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2}
# vaultUrlDocker: vault URL reachable from inside Docker (uses nginx service name)
export vaultUrl=$(yq '.urlConfig.vaultUrlDocker' /config/ethconf.yaml)
