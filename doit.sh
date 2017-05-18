#!/bin/bash

#until netcat -z ${PG_ENV_POSTGRES_HOST} ${PG_ENV_POSTGRES_PORT} >&/dev/null
#do echo "Waiting for postgres to start"
#   sleep 1
#done

while true
do postgrest postgres://${PG_ENV_POSTGRES_USER}:${PG_ENV_POSTGRES_PASSWORD}@${PG_ENV_POSTGRES_HOST}:${PG_PORT_5432_TCP_PORT}/${PG_ENV_POSTGRES_DB} \
              --port ${POSTGREST_LISTEN_PORT} \
              --schema ${POSTGREST_SCHEMA} \
              --anonymous ${POSTGREST_ANONYMOUS} \
              --pool ${POSTGREST_POOL} \
              --jwt-secret ${POSTGREST_JWT_SECRET} \
              --max-rows ${POSTGREST_MAX_ROWS}
done

