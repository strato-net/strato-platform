#!/bin/sh
set -e

# Read chainId and networkName from ethconf.yaml
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

# Generate runtime configuration file
cat > dist/config.js << EOF
window.ENV = {
  CHAIN_ID: ${CHAIN_ID},
  NETWORK_NAME: "${NETWORK_NAME}",
  LUCKY_ORANGE_SITE_ID: "${LUCKY_ORANGE_SITE_ID:-}",
  GOOGLE_ANALYTICS_ID: "${GOOGLE_ANALYTICS_ID:-}"
};
EOF

exec serve -s dist -l 8080
