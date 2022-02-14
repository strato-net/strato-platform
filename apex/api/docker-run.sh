#!/usr/bin/env bash
set -e
set -x

source set-aux-env-vars.sh

# Set postgres configurations
sed -i -e 's|__apex_postgres_user__|'"${postgres_user}"'|g' config/config.json
sed -i -e 's|__apex_postgres_password__|'"${postgres_password}"'|g' config/config.json
sed -i -e 's|__apex_postgres_host__|'"${postgres_host}"'|g' config/config.json
sed -i -e 's|__apex_postgres_port__|'"${postgres_port}"'|g' config/config.json

sed -i -e 's|__bloc_postgres_user__|'"${postgres_user}"'|g' models/strato/bloc22/config.json
sed -i -e 's|__bloc_postgres_password__|'"${postgres_password}"'|g' models/strato/bloc22/config.json
sed -i -e 's|__bloc_postgres_host__|'"${postgres_host}"'|g' models/strato/bloc22/config.json
sed -i -e 's|__bloc_postgres_port__|'"${postgres_port}"'|g' models/strato/bloc22/config.json

sed -i -e 's|__oauth_postgres_user__|'"${postgres_user}"'|g' models/strato/oauth/config.json
sed -i -e 's|__oauth_postgres_password__|'"${postgres_password}"'|g' models/strato/oauth/config.json
sed -i -e 's|__oauth_postgres_host__|'"${postgres_host}"'|g' models/strato/oauth/config.json
sed -i -e 's|__oauth_postgres_port__|'"${postgres_port}"'|g' models/strato/oauth/config.json

sed -i -e 's|__strato_postgres_user__|'"${postgres_user}"'|g' models/strato/eth/config.js
sed -i -e 's|__strato_postgres_password__|'"${postgres_password}"'|g' models/strato/eth/config.js
sed -i -e 's|__strato_postgres_host__|'"${postgres_host}"'|g' models/strato/eth/config.js
sed -i -e 's|__strato_postgres_port__|'"${postgres_port}"'|g' models/strato/eth/config.js

echo 'Waiting for strato to be available...'
until curl --silent --output /dev/null --fail --location ${stratoRoot}/uuid
do
  echo "Check at $(date)"
  sleep 1
done
echo 'strato is available'

echo 'Waiting for postgres to be available...'
until pg_isready -h ${postgres_host} -p ${postgres_port}
do
    echo "Check at $(date)"
    sleep 1
done
echo 'postgres is available'

NODE_HOST=${NODE_HOST} npm run start:prod
