#!/usr/bin/env sh
set -e
set -x

# TODO: Set POSTGRES vars defaults here, remove default from docker-compose.yml, rename postgres vars using uppercase
# These must be exported so Node.js can access them via process.env
export PROMETHEUS_HOST=${PROMETHEUS_HOST:-'prometheus:9090'}
export redis_host=${redis_host:-redis}
export redis_port=${redis_port:-6379}

source set-aux-env-vars.sh

# Read postgres password from mounted secrets file
if [ -f /run/secrets/postgres_password ]; then
  postgres_password=$(cat /run/secrets/postgres_password)
fi

# Set postgres configurations. Write via temp files and overwrite (rather than
# `sed -i`, which creates its temp in the dir) so this works when running as a
# non-root user with only the files themselves made writable.
sed -e 's|__apex_postgres_user__|'"${postgres_user}"'|g' \
    -e 's|__apex_postgres_password__|'"${postgres_password}"'|g' \
    -e 's|__apex_postgres_host__|'"${postgres_host}"'|g' \
    -e 's|__apex_postgres_port__|'"${postgres_port}"'|g' \
    config/config.json > /tmp/apex-config.json
cat /tmp/apex-config.json > config/config.json

sed -e 's|__bloc_postgres_user__|'"${postgres_user}"'|g' \
    -e 's|__bloc_postgres_password__|'"${postgres_password}"'|g' \
    -e 's|__bloc_postgres_host__|'"${postgres_host}"'|g' \
    -e 's|__bloc_postgres_port__|'"${postgres_port}"'|g' \
    models/strato/bloc22/config.json > /tmp/bloc22-config.json
cat /tmp/bloc22-config.json > models/strato/bloc22/config.json

sed -e 's|__strato_postgres_user__|'"${postgres_user}"'|g' \
    -e 's|__strato_postgres_password__|'"${postgres_password}"'|g' \
    -e 's|__strato_postgres_host__|'"${postgres_host}"'|g' \
    -e 's|__strato_postgres_port__|'"${postgres_port}"'|g' \
    models/strato/eth/config.js > /tmp/eth-config.js
cat /tmp/eth-config.js > models/strato/eth/config.js

echo 'Waiting for postgres to be available...'
until pg_isready -h ${postgres_host} -p ${postgres_port}
do
    echo "Check at $(date)"
    sleep 1
done
echo 'postgres is available'

exec npm run start:prod
