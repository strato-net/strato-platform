#!/usr/bin/env bash
set -o
set -e

# Prepare testdata
cd test/testdata
rm -rf testdata.zip addresses.js
zip -r testdata.zip .
cd -

# Set environment variables
export SINGLE_NODE=true
export NODE_HOST=localhost
export NODE_ENV=test
export stratoRoot=http://localhost/strato-api/eth/v1.2/

export PG_HOST=localhost
export PG_PORT=9090
export PG_USER=postgres
# Different syntax because this is read by psql
export PGPASSWORD=api

POSTGRES_NAME=apex_tests_postgres
trap "docker rm -f ${POSTGRES_NAME}" EXIT
docker run -d -p 9090:5432 --name="${POSTGRES_NAME}" \
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

./node_modules/mocha/bin/mocha --config=config-local.yaml test/
