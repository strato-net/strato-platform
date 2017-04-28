#!/bin/bash

echo "postgres:${PG_ENV_POSTGRES_PASSWORD}@postgres:${PG_PORT_5433_TCP_PORT}/${PG_ENV_POSTGRES_DB}"
env

until netcat -z postgres 5432 >&/dev/null
do echo "Waiting for postgres to start"
   sleep 1
done

while true
do postgrest postgres://postgres:${PG_ENV_POSTGRES_PASSWORD}@postgres:${PG_PORT_5433_TCP_PORT}/${PG_ENV_POSTGRES_DB} \
              --port 3001 \
              --schema ${POSTGREST_SCHEMA} \
              --anonymous ${POSTGREST_ANONYMOUS} \
              --pool ${POSTGREST_POOL} \
              --jwt-secret ${POSTGREST_JWT_SECRET} \
              --max-rows ${POSTGREST_MAX_ROWS}
done

