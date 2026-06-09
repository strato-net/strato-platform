#!/bin/bash
set -e

sudo \
  ssl=false \
  HTTP_PORT=8080 \
  INITIAL_OAUTH_DISCOVERY_URL='https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration' \
  INITIAL_OAUTH_ISSUER='https://keycloak.blockapps.net/auth/realms/mercata' \
  INITIAL_OAUTH_JWT_USERNAME_CLAIM='sub' \
  docker compose -f docker-compose.vault.yml -p vault up -d

bash enter-password.sh
