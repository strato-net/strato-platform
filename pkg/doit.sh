#!/bin/bash

echo "Hello postgrest-packager:doit.sh"

POSTGREST_VERSION=0.3.2.0
POSTGREST_SCHEMA=public
POSTGREST_ANONYMOUS=postgres
POSTGREST_JWT_SECRET=thisisnotarealsecret
POSTGREST_MAX_ROWS=1000000
POSTGREST_POOL=200

echo "postgres:${PG_ENV_POSTGRES_PASSWORD}@postgres:${PG_PORT_5433_TCP_PORT}/${PG_ENV_POSTGRES_DB}"
env

exec postgrest postgres://postgres:${PG_ENV_POSTGRES_PASSWORD}@postgres:${PG_PORT_5433_TCP_PORT}/${PG_ENV_POSTGRES_DB} \
              --port 3001 \
              --schema ${POSTGREST_SCHEMA} \
              --anonymous ${POSTGREST_ANONYMOUS} \
              --pool ${POSTGREST_POOL} \
              --jwt-secret ${POSTGREST_JWT_SECRET} \
              --max-rows ${POSTGREST_MAX_ROWS}

#service postgresql start
#sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'api';"
#tail -n0 -F /var/log/postgresql/postgresql-*.log 
