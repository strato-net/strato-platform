#!/bin/sh
set -e

# OAuth discovery URL for JWT (JWKS) verification of dashboard users. The
# tracking service never needs a client id/secret: Cirrus reads are anonymous
# GETs and users present their own bearer tokens.
if [ -f /run/secrets/oauth_credentials.yaml ]; then
  export OPENID_DISCOVERY_URL="${OPENID_DISCOVERY_URL:-$(grep "discoveryUrl:" /run/secrets/oauth_credentials.yaml | cut -d'"' -f2)}"
fi

if [ -f /run/secrets/postgres_password ]; then
  export postgres_password=$(cat /run/secrets/postgres_password)
fi

# In a standalone deployment NODE_URL points at the STRATO node's public edge
# (e.g. https://app.strato.nexus) for anonymous Cirrus reads. The fallback is
# the platform-stack convention (edge nginx on HTTP_PORT 8081).
export NODE_URL="${NODE_URL:-http://nginx:8081}"

echo "Starting tracking service..."
exec node dist/index.js
