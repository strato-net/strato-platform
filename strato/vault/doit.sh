#!/bin/bash

set -e

minLogLevel=LevelInfo
if [ "${VAULTWRAPPER_DEBUG:-false}" == true ]; then
  minLogLevel=LevelDebug
fi

echo "Environment variables:
vault-wrapper:
--phsot=\$postgres_host="${postgres_host}"
--pgport=\$postgres_port="${postgres_port}"
--pguser=\$postgres_user="${postgres_user}"
--password=\$postgres_password="***"
--database=\$postgres_vault_wrapper_db="${postgres_vault_wrapper_db}"
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

PGPASSWORD=${postgres_password} psql -h "$postgres_host" -p "$postgres_port" -U "$postgres_user" \
  -d "$postgres_vault_wrapper_db" -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' > /dev/null

RED='\033[0;31m'
NC='\033[0m' # No Color

exec blockapps-vault-wrapper-server \
  --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" \
  --password="$postgres_password" --database="$postgres_vault_wrapper_db" --minLogLevel="${minLogLevel}" --keyStoreCacheTimeout="$keyStoreCacheTimeout"

