# exported values are accessible in the app via process.env[]
export stratoRoot=http://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2
export vaultProxyUrl=http://${STRATO_HOSTNAME}:${STRATO_PORT_VAULT_PROXY}
export STATS_ENABLED=${STATS_ENABLED:-true}
export STATS_SUBMIT_ENABLED=${STATS_SUBMIT_ENABLED:-true}
export STATS_SUBMIT_CONTRACT_TYPES_ENABLED=${STATS_SUBMIT_CONTRACT_TYPES_ENABLED:-true}
