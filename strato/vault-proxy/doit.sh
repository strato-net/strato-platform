#!/bin/bash

set -ex

minLogLevel=LevelInfo
if [ "${VAULTproxy_DEBUG:-false}" == true ]; then
  minLogLevel=LevelDebug
fi

echo "Environment variables:
vault-proxy:
--phsot=\$postgres_host="${postgres_host}"
--pgport=\$postgres_port="${postgres_port}"
--pguser=\$postgres_user="${postgres_user}"
--password=\$postgres_password="${postgres_password}"
--database=\$postgres_vault_proxy_db="${postgres_vault_proxy_db}"
--minLogLevel="${minLogLevel}"
--keyStoreCacheTimeout="${keyStoreCacheTimeout}"
"

echo 'Waiting for postgres to be available...'
until pg_isready -h ${postgres_host} -p ${postgres_port}
do
    echo "Check at $(date)"
    sleep 1
done
echo 'postgres is available'

PSQL_CONNECTION_PARAMS="-h ${postgres_host} -p ${postgres_port} -U ${postgres_user}"
# Check if this container was initialized before
if [ ! -f _container_initialized ]; then
    # Create the database for vault-proxy if does not exist from previous STRATO deployments (e.g. STRATO upgrade flow)
    if ! PGPASSWORD=${postgres_password} psql ${PSQL_CONNECTION_PARAMS} -lqt | cut -d \| -f 1 | grep -qw ${postgres_vault_proxy_db}; then
      echo "Creating the '${postgres_vault_proxy_db}' database"
      PGPASSWORD=${postgres_password} createdb ${PSQL_CONNECTION_PARAMS} ${postgres_vault_proxy_db}
    else
      echo "Using the existing '${postgres_vault_proxy_db}' database from previous STRATO deployment"
    fi
    # Create the '_container_initialized' sentinel file
    date '+%Y-%m-%d %H:%M:%S' > _container_initialized
fi

RED='\033[0;31m'
NC='\033[0m' # No Color

blockapps-vault-proxy-server \
  --OAUTH_ENABLED="$OAUTH_ENABLED" --OAUTH_DISCOVERY_URL="$OAUTH_DISCOVERY_URL" --OAUTH_CLIENT_ID="$OAUTH_CLIENT_ID" \
  --OAUTH_CLIENT_SECRET="$OAUTH_CLIENT_SECRET" --OAUTH_RESERVE_SECONDS="$OAUTH_RESERVE_SECONDS"  --OAUTH_SERVICE_USER_CLIENT_ID="${OAUTH_SERVICE_USER_CLIENT_ID}"
  --OAUTH_SERVICE_USER_CLIENT_SECRET="${OAUTH_SERVICE_USER_CLIENT_SECRET}" --VAULT_URL="${VAULT_URL}" --VAULT_PORT="${VAULT_PORT}" \
  --VAULT_PASSWORD="${VAULT_PASSWORD}" --VAULT_PROXY_PORT="${VAULT_PROXY_PORT}" --VAULT_PROXY_URL="${VAULT_PROXY_URL}" \
  --minLogLevel="${minLogLevel}" \
  || set +x && echo -e "\n${RED}blockapps-vault-proxy-server has terminated!!!${NC}" && tail -f /dev/null