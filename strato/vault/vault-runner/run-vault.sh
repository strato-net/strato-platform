#!/bin/bash
set -e

cd "$(dirname "$0")"
compose_quote() {
  local value=${1//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//\$/\$\$}
  printf '"%s"' "$value"
}
env_has() {
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" .env 2>/dev/null
}
append_env() {
  # A .env from an earlier release may end without a newline.
  if [ -s .env ] && [ -n "$(tail -c 1 .env)" ]; then printf '\n' >> .env; fi
  { printf '%s=' "$1"; compose_quote "$2"; printf '\n'; } >> .env
  chmod 600 .env
}

# Each credential on its own: a .env from before the dedicated Vault login
# keeps its administrator password and other settings and only gains the
# missing postgres_vault_password.
umask 077
if ! env_has postgres_password; then
  if sudo docker volume inspect vault_vaultpgdata >/dev/null 2>&1; then
    IFS= read -r -s -p "Existing PostgreSQL administrator password: " postgres_password
    echo
    [ -n "$postgres_password" ] || { echo "PostgreSQL password is required" >&2; exit 1; }
  else
    postgres_password=$(openssl rand -hex 32)
  fi
  append_env postgres_password "$postgres_password"
fi
if ! env_has postgres_vault_password; then
  postgres_vault_password=$(openssl rand -hex 32)
  append_env postgres_vault_password "$postgres_vault_password"
fi

sudo \
  ssl=false \
  HTTP_PORT=8080 \
  INITIAL_OAUTH_DISCOVERY_URL='https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration' \
  INITIAL_OAUTH_ISSUER='https://keycloak.blockapps.net/auth/realms/mercata' \
  INITIAL_OAUTH_JWT_USERNAME_CLAIM='sub' \
  docker compose -f docker-compose.vault.yml -p vault up -d || {
  # Compose only says that pg-init exited; its log has the reason.
  sudo docker logs vault-pg-init-1 >&2 || true
  echo "The Vault stack did not start. If pg-init rejected the PostgreSQL administrator password, correct postgres_password in .env and run this script again." >&2
  exit 1
}

bash enter-password.sh
