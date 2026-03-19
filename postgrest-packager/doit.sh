#!/bin/bash

set -e
set -x

# Read postgres password from mounted secrets file
if [ -f /run/secrets/postgres_password ]; then
  PG_ENV_POSTGRES_PASSWORD=$(cat /run/secrets/postgres_password)
fi

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