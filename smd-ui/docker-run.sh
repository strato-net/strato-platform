#!/bin/sh
set -e

# Anchor to the script's directory so relative paths (dist/) resolve regardless of
# the working directory the orchestrator invokes us from.
cd "$(dirname "$0")"

# Read chainId and network from ethconf.yaml (single source of truth), matching
# the STRATO App UI. These drive the STRATO chain in the wallet connector. Fail fast
# (like the STRATO App UI) so a missing/unmounted config surfaces as a crash-loop
# rather than silently dropping the STRATO wallet from the connector list.
CHAIN_ID=$(grep "^  chainId:" /config/ethconf.yaml | awk '{print $2}')
NETWORK_NAME=$(grep "^  network:" /config/ethconf.yaml | awk '{print $2}' | tr -d '"')

if [ -z "$CHAIN_ID" ]; then
  echo "ERROR: Could not read chainId from /config/ethconf.yaml" >&2
  exit 1
fi

if [ -z "$NETWORK_NAME" ]; then
  echo "ERROR: Could not read network name from /config/ethconf.yaml" >&2
  exit 1
fi

# Generate runtime configuration consumed by /smd/config.js (window.ENV).
# Overwrite the file in place (it's made writable in the Dockerfile) so this works
# when running as a non-root user without write access to the dist/ directory.
cat > dist/config.js << EOF
window.ENV = {
  CHAIN_ID: ${CHAIN_ID},
  NETWORK_NAME: "${NETWORK_NAME}",
  RPC_URL: "${RPC_URL:-/rpc}",
  EXPLORER_URL: "${EXPLORER_URL:-}",
  WAGMI_PROJECT_ID: "${WAGMI_PROJECT_ID:-}"
};
EOF

# --single: SPA fallback so client-side routes resolve to index.html.
exec env NO_UPDATE_CHECK=1 serve --single -l 3002 dist
