#!/bin/sh
# Renders the UI's runtime configuration (dist/config.js, read by the app as
# window.ENV) from environment variables, for static hosting of the built
# bundle (S3 + CloudFront) where no container entrypoint runs. The container
# entrypoint (docker-run.sh) produces the same file from the node's
# ethconf.yaml; keep the two in step.
#
#   CHAIN_ID=8081 NETWORK_NAME=helium ./render-config.sh [dist-dir]
set -e

DIST=${1:-dist}
: "${CHAIN_ID:?CHAIN_ID is required (networkConfig.chainId of the node)}"
: "${NETWORK_NAME:?NETWORK_NAME is required (networkConfig.network of the node)}"

mkdir -p "$DIST"
cat > "$DIST/config.js" << EOC
window.ENV = {
  CHAIN_ID: ${CHAIN_ID},
  NETWORK_NAME: "${NETWORK_NAME}",
  POSTHOG_KEY: "${POSTHOG_KEY:-}",
  POSTHOG_HOST: "${POSTHOG_HOST:-}",
  GOOGLE_ANALYTICS_ID: "${GOOGLE_ANALYTICS_ID:-}"
};
EOC
echo "wrote $DIST/config.js"
