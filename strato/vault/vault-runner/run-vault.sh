#!/bin/bash
set -e

if [ ! -f docker-compose.vault.yml ]; then
  echo 'Generate docker-compose.vault.yml at the repo root and copy it here first.' >&2
  exit 1
fi

umask 077
printf '%s\n' 'postgres:5432:*:postgres:api' > vault.pgpass
chmod 600 vault.pgpass

sudo \
  COMPOSE_PROFILES=local-postgres \
  VAULT_CREATE_DB=true \
  VAULT_PGPASS_FILE=./vault.pgpass \
  PGSSLMODE=disable \
  PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt \
  VAULT_NGINX_PORT=8080:80 \
  ssl=false \
  INITIAL_OAUTH_DISCOVERY_URL='https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration' \
  INITIAL_OAUTH_ISSUER='https://keycloak.blockapps.net/auth/realms/mercata' \
  INITIAL_OAUTH_JWT_USER_ID_CLAIM='sub' \
  docker compose -f docker-compose.vault.yml -p vault up -d

bash enter-password.sh
