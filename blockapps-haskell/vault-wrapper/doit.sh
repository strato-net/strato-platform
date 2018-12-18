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
    # Create the database for vault-wrapper if does not exist from previous STRATO deployments (e.g. STRATO upgrade flow)
    if ! PGPASSWORD=${postgres_password} psql ${PSQL_CONNECTION_PARAMS} -lqt | cut -d \| -f 1 | grep -qw ${postgres_vault_wrapper_db}; then
      echo "Creating the '${postgres_vault_wrapper_db}' database"
      PGPASSWORD=${postgres_password} createdb ${PSQL_CONNECTION_PARAMS} ${postgres_vault_wrapper_db}
    else
      echo "Using the existing '${postgres_vault_wrapper_db}' database from previous STRATO deployment"
    fi
    # Create the 'initialized' sentinel file
    date '+%Y-%m-%d %H:%M:%S' > initialized
fi

/usr/bin/blockapps-vault-wrapper-server --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" --password="$postgres_password" \
                       --database="$postgres_vault_wrapper_db" --loglevel="${loglevel:-4}"
