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

POSTGRES_NAME=apex_tests_postgres
trap "docker rm -f ${POSTGRES_NAME}" EXIT
docker run -d -p 9090:5432 --name="${POSTGRES_NAME}" \
	-e POSTGRES_PASSWORD=api \
  -e POSTGRES_DB=cirrus \
	-v "/var/lib/postgresql/data" \
	postgres:9.6
echo 'Waiting for postgres to be available...'
while true; do
    curl "${PG_HOST}:${PG_PORT}" > /dev/null 2>&1 || EXIT_CODE=$? && true
    if [ ${EXIT_CODE} = 52 ]; then
        break
    fi
    sleep 1
done
echo 'postgres is available'

mocha --config=config-local.yaml test/
