#!/usr/bin/env bash
set -e
set -x

postgrestRoot=http://${postgrestHost}
export blocRoot=http://${blocHost}/bloc/v2.2 # Used in apex to compile contracts
export stratoRoot=http://${stratoHost}/eth/v1.2 # to be available from js AS WELL
export STRATO_GS_MODE=${STRATO_GS_MODE} # to be available from js
export PROD_DEV_MODE=${PROD_DEV_MODE:-false} # to be available from js

sed -i -e 's|__stratoUrl__|http://'"${stratoHost}"'|g' config-prod.yaml
sed -i -e 's|__blocUrl__|'"${blocRoot}"'|g' config-prod.yaml
# Despite blockapps-rest wasn't initially designed for use inside the platform (to interact between micro-services) and 
# should only call STRATO platform through nginx - starting with version 6.4.0 it supports different formats of searchUrl
# to be also used to call postgrest directly, without 'cirrus/(search)' substring in URI
sed -i -e 's|__searchUrl__|'"${postgrestRoot}"'|g' config-prod.yaml

# Set postgres configurations
sed -i -e 's|__apex_postgres_user__|'"${postgres_user}"'|g' config/config.json
sed -i -e 's|__apex_postgres_password__|'"${postgres_password}"'|g' config/config.json
sed -i -e 's|__apex_postgres_host__|'"${postgres_host}"'|g' config/config.json
sed -i -e 's|__apex_postgres_port__|'"${postgres_port}"'|g' config/config.json

sed -i -e 's|__bloc_postgres_user__|'"${postgres_user}"'|g' models/strato/bloc22/config.json
sed -i -e 's|__bloc_postgres_password__|'"${postgres_password}"'|g' models/strato/bloc22/config.json
sed -i -e 's|__bloc_postgres_host__|'"${postgres_host}"'|g' models/strato/bloc22/config.json
sed -i -e 's|__bloc_postgres_port__|'"${postgres_port}"'|g' models/strato/bloc22/config.json

sed -i -e 's|__strato_postgres_user__|'"${postgres_user}"'|g' models/strato/eth/config.js
sed -i -e 's|__strato_postgres_password__|'"${postgres_password}"'|g' models/strato/eth/config.js
sed -i -e 's|__strato_postgres_host__|'"${postgres_host}"'|g' models/strato/eth/config.js
sed -i -e 's|__strato_postgres_port__|'"${postgres_port}"'|g' models/strato/eth/config.js


echo 'Waiting for bloc to be available...'
until curl --silent --output /dev/null --fail --location ${blocRoot}
do
  sleep 1
done
echo 'bloc is available'

echo 'Waiting for strato to be available...'
until curl --silent --output /dev/null --fail --location ${stratoRoot}/uuid
do
  echo "Check at $(date)"
  sleep 1
done
echo 'strato is available'

echo 'Waiting for postgrest to be available...'
until curl --silent --output /dev/null --fail --location ${postgrestRoot}
do
  echo "Check at $(date)"
  sleep 1
done
echo 'cirrus is available'

echo 'Waiting for postgres to be available...'
until pg_isready -h ${postgres_host} -p ${postgres_port}
do
    echo "Check at $(date)"
    sleep 1
done
echo 'postgres is available'

NODE_HOST=${NODE_HOST} npm run start:prod
