#!/usr/bin/env bash
set -e
set -x

export blocRoot=http://${blocHost}/bloc/v2.2 # see config-prod.yaml
export cirrusRoot=http://${cirrusHost} # see config-prod.yaml
export postgresHost=${postgres_host}:${postgres_port} # see config/config.json
export stratoRoot=http://${stratoHost}/eth/v1.2 # ALSO see config-prod.yaml

sed -i -e 's|__stratoUrl__|http://'"${stratoHost}"'|g' config-prod.yaml
sed -i -e 's|__blocUrl__|'"${blocRoot}"'|g' config-prod.yaml
sed -i -e 's|__searchUrl__|'"${cirrusRoot}"'|g' config-prod.yaml

export STRATO_GS_MODE=${STRATO_GS_MODE} # to be available from js
export PROD_DEV_MODE=${PROD_DEV_MODE:-false} # to be available from js

echo 'Waiting for bloc to be available...'
until curl --silent --output /dev/null --fail --location ${blocRoot}
do
  sleep 1
done
echo 'bloc is available'

echo 'Waiting for strato to be available...'
until curl --silent --output /dev/null --fail --location ${stratoRoot}/uuid
do
  sleep 1
done
echo 'strato is available'

echo 'Waiting for cirrus to be available...'
until curl --silent --output /dev/null --fail --location ${cirrusRoot}
do
  sleep 1
done
echo 'cirrus is available'

echo 'Waiting for postgres to be available...'
while true; do
    curl ${postgresHost} > /dev/null 2>&1 || EXIT_CODE=$? && true
    if [ ${EXIT_CODE} = 52 ]; then
        break
    fi
    sleep 1
done
echo 'postgres is available'

NODE_HOST=${NODE_HOST} npm run start:prod
