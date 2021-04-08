# exported values are accessible in the app via process.env[]
export blocHttpHost=http://${stratoHost}
export blocRoot=http://${stratoHost}/bloc/v2.2
export postgrestHttpHost=http://${postgrestHost}
export stratoRoot=http://${stratoHost}/eth/v1.2
export vaultWrapperHttpHost=http://${vaultWrapperHost}
export STATS_ENABLED=${STATS_ENABLED:-true}
export STATS_SUBMIT_ENABLED=${STATS_SUBMIT_ENABLED:-true}
export STATS_SUBMIT_CONTRACT_TYPES_ENABLED=${STATS_SUBMIT_CONTRACT_TYPES_ENABLED:-true}
