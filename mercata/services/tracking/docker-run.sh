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

# Same convention as mercata-backend: internal calls go through the edge nginx,
# which listens on HTTP_PORT (8081 on platform deployments)
export NODE_URL='http://nginx:8081'

echo "Starting tracking service..."
exec node dist/index.js
