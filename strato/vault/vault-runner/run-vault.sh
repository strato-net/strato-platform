#!/bin/bash
set -e

cd "$(dirname "$0")"
compose_quote() {
  local value=${1//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//\$/\$\$}
  printf '"%s"' "$value"
}

if [ ! -f .env ]; then
  umask 077
  if sudo docker volume inspect vault_vaultpgdata >/dev/null 2>&1; then
    read -r -s -p "Existing PostgreSQL administrator password: " postgres_password
    echo
    [ -n "$postgres_password" ] || { echo "PostgreSQL password is required" >&2; exit 1; }
  else
    postgres_password=$(openssl rand -hex 32)
  fi
  postgres_vault_password=$(openssl rand -hex 32)
  {
    printf 'postgres_password='
    compose_quote "$postgres_password"
    printf '\npostgres_vault_password='
    compose_quote "$postgres_vault_password"
    printf '\n'
  } > .env
fi

sudo \
  ssl=false \
  HTTP_PORT=8080 \
  INITIAL_OAUTH_DISCOVERY_URL='https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration' \
  INITIAL_OAUTH_ISSUER='https://keycloak.blockapps.net/auth/realms/mercata' \
  INITIAL_OAUTH_JWT_USERNAME_CLAIM='sub' \
  docker compose -f docker-compose.vault.yml -p vault up -d

bash enter-password.sh
