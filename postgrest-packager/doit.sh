#!/bin/bash

set -e
set -x

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