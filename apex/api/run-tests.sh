#!/usr/bin/env bash
set -o
set -e

# Prepare testdata
cd test/testdata
rm -rf testdata.zip addresses.js
zip -r testdata.zip .
cd -

if [ "$NODE_ENV" == development ]; then

  echo " "
  echo "==========="
  echo "Fixme: Have you run start:dev yet to create the apex_dev database?"
  echo "Todo: maybe create that here instead..."
  echo "==========="
  echo " "

  # Check if postgres client is installed
  if ! command -v psql &> /dev/null; then
    echo "no postgres-client installed, please install"
    exit 20
  fi

  # Set environment variables
  export SINGLE_NODE=true
  export NODE_HOST=localhost
  export OAUTH_ENABLED=${OAUTH_ENABLED:-}

  #strato:3000 , bloc:8000 & vault-wrapper:8000 ports should be mapped locally in your docker-compose.yml
  export blocRoot=${BLOC_HOST}/bloc/v2.2
  export stratoRoot=${STRATO_HOST}/eth/v1.2
  export vaultRoot=${VAULT_HOST}/strato/v2.3

  export PG_HOST=localhost
  export PG_PORT=5432
  export PG_USER=postgres
  # Different syntax because this is read by psql
  export PGPASSWORD=api

  POSTGRES_NAME=apex_tests_postgres
  trap "docker rm -f ${POSTGRES_NAME}" EXIT
  docker run -d -p 5432:5432 --name="${POSTGRES_NAME}" \
    -e POSTGRES_PASSWORD=api \
    -e POSTGRES_DB=cirrus \
    -v "/var/lib/postgresql/data" \
    postgres:9.6

  until psql -h "${PG_HOST}" \
             -p "${PG_PORT}" \
             -U "${PG_USER}" \
             -c "SELECT 1;" \
             >/dev/null \
             2>/dev/null
  do
    echo 'Waiting for postgres to be available...'
      sleep 1
  done
  echo 'postgres is available'




  ./node_modules/mocha/bin/mocha $NODE_DEBUG_OPTION --config=config-local.yaml test/
fi

# For jenkins, we expect a running environment
if [ "$NODE_ENV" == test ]; then
  export stratoRoot="http://${stratoHost}/eth/v1.2"
  export blocRoot="http://${blocHost}/bloc/v2.2"
  ./node_modules/mocha/bin/mocha $NODE_DEBUG_OPTION --config=config-prod.yaml test/
fi
