#!/bin/sh
set -e

# Regenerate runtime config from env at container start (mercata-ui pattern)
cat > /app/dist/config.js <<EOF
window.ENV = {
  OIDC_AUTHORITY: '${OIDC_AUTHORITY:-https://keycloak.blockapps.net/auth/realms/mercata}',
  OIDC_CLIENT_ID: '${OIDC_CLIENT_ID:-tracking-dashboard}',
  EXPLORER_URL: '${EXPLORER_URL:-https://stratoscan.strato.nexus}',
};
EOF

echo "Starting tracking dashboard..."
exec serve -s dist -l 8080
