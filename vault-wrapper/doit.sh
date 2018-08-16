#!/bin/bash

set -ex

echo "Environment variables:
vault-wrapper:
--phsot=\$postgres_host="${postgres_host}"
--pgport=\$postgres_port="${postgres_port}"
--pguser=\$postgres_user="${postgres_user}"
--password=\$postgres_password="${postgres_password}"
--database=\$postgres_vault_wrapper_db="${postgres_vault_wrapper_db}"
"

echo 'Waiting for postgres to be available...'
while true; do
    curl ${postgres_host}:${postgres_port} > /dev/null 2>&1 || EXIT_CODE=$? && true
    if [ ${EXIT_CODE} = 52 ]; then
        break
    fi
    sleep 0.5
done

PSQL_CONNECTION_PARAMS="-h ${postgres_host} -p ${postgres_port} -U ${postgres_user}"
# Check if this container was initialized before
if [ ! -f initialized ]; then
    # drop vault-wrapper db if already exists
    PGPASSWORD=${postgres_password} dropdb ${PSQL_CONNECTION_PARAMS} --if-exists ${postgres_vault_wrapper_db}
    # Create the database for vault-wrapper
    PGPASSWORD=${postgres_password} createdb ${PSQL_CONNECTION_PARAMS} ${postgres_vault_wrapper_db}
    # Create the 'initialized' sentinel file
    date '+%Y-%m-%d %H:%M:%S' > initialized
fi

/usr/bin/vault-wrapper --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" --password="$postgres_password" \
                       --database="$postgres_vault_wrapper_db" --loglevel="${loglevel:-4}"
