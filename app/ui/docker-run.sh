#!/bin/sh
set -e

# Read chainId and networkName from ethconf.yaml when a node's config is
# mounted (bundled deployment); otherwise take them from the environment
# (standalone app tier, which has no node directory).
if [ -f /config/ethconf.yaml ]; then
  CHAIN_ID=$(grep "^  chainId:" /config/ethconf.yaml | awk '{print $2}')
  NETWORK_NAME=$(grep "^  network:" /config/ethconf.yaml | awk '{print $2}' | tr -d '"')
else
  CHAIN_ID=${CHAIN_ID:-}
  NETWORK_NAME=${NETWORK_NAME:-}
fi

if [ -z "$CHAIN_ID" ]; then
  echo "ERROR: chainId not found: mount /config/ethconf.yaml or set CHAIN_ID" >&2
  exit 1
fi

if [ -z "$NETWORK_NAME" ]; then
  echo "ERROR: network name not found: mount /config/ethconf.yaml or set NETWORK_NAME" >&2
  exit 1
fi

# Generate runtime configuration file
cat > dist/config.js << EOF
window.ENV = {
  CHAIN_ID: ${CHAIN_ID},
  NETWORK_NAME: "${NETWORK_NAME}",
  POSTHOG_KEY: "${POSTHOG_KEY:-}",
  POSTHOG_HOST: "${POSTHOG_HOST:-}",
  GOOGLE_ANALYTICS_ID: "${GOOGLE_ANALYTICS_ID:-}"
};
EOF

exec serve -s dist -l 8080
