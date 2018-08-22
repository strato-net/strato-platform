#!/bin/bash

set -e
set -x

# Checking for bloc to be running to avoid using the slipstream database before it was initialized in bloc's doit.sh
blocRoot=http://${blocHost}/bloc/v2.2
echo 'Waiting for bloc to be available...'
until curl --silent --output /dev/null --fail --location ${blocRoot}
do
  sleep 1
done
echo 'bloc is available'

echo "the pg host and port are: ${PG_ENV_POSTGRES_HOST} ${PG_PORT_5432_TCP_PORT}"

until PGPASSWORD=${PG_ENV_POSTGRES_PASSWORD:-""} psql -h "${PG_ENV_POSTGRES_HOST}" -p ${PG_PORT_5432_TCP_PORT} -U "postgres" -c '\q'; do
  >&2 echo "Postgres is unavailable - sleeping"
  sleep 1
done

render_template() {
  eval "echo \"$(sed 's/\"/\\"/g' $1)\""
}

render_template postgrest.conf.tpl > postgrest.conf

exec postgrest postgrest.conf