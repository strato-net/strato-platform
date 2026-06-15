#!/bin/sh
set -e

# Anchor to the script's directory so relative paths (dist/) resolve regardless of
# the working directory the orchestrator invokes us from.
cd "$(dirname "$0")"

# Read chainId and network from ethconf.yaml (single source of truth), matching
# the mercata UI. These drive the STRATO chain in the wallet connector.
CHAIN_ID=$(grep "^  chainId:" /config/ethconf.yaml 2>/dev/null | awk '{print $2}')
NETWORK_NAME=$(grep "^  network:" /config/ethconf.yaml 2>/dev/null | awk '{print $2}' | tr -d '"')

# Generate runtime configuration consumed by /smd/config.js (window.ENV).
cat > dist/config.js << EOF
window.ENV = {
  CHAIN_ID: ${CHAIN_ID:-null},
  NETWORK_NAME: "${NETWORK_NAME:-}",
  RPC_URL: "${RPC_URL:-/rpc}",
  EXPLORER_URL: "${EXPLORER_URL:-}",
  WAGMI_PROJECT_ID: "${WAGMI_PROJECT_ID:-}"
};
EOF

# --single: SPA fallback so client-side routes resolve to index.html.
exec env NO_UPDATE_CHECK=1 serve --single -l 3002 dist
