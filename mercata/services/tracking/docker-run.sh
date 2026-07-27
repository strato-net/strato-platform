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

# Deliberately no NODE_URL: this service never talks to STRATO nodes or
# Cirrus. Chain data is served by the mercata backend.

echo "Starting tracking service..."
exec node dist/index.js
