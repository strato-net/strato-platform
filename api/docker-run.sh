#!/usr/bin/env bash
set -e
set -x

echo 'Waiting for bloc to be available...'
until curl --silent --output /dev/null --fail --location nginx/bloc/v2.2/users/
do
  sleep 1
done
echo 'bloc is available'

echo 'Waiting for cirrus to be available...'
until curl --silent --output /dev/null --fail --location nginx/cirrus/contract/
do
  sleep 1
done
echo 'cirrus is available'

echo 'Waiting for postgres to be available...'
while true; do
    curl postgres:5432 > /dev/null 2>&1 || EXIT_CODE=$? && true
    if [ ${EXIT_CODE} = 52 ]; then
        break
    fi
    sleep 1
done
echo 'postgres is available'

STRATO_LOCAL_HOST=${STRATO_LOCAL_HOST:-nginx}

sed -i 's/__STRATO_LOCAL_HOST__/'"${STRATO_LOCAL_HOST}"'/g' config-prod.yaml

STRATO_LOCAL_HOST=${STRATO_LOCAL_HOST} NODE_HOST=${NODE_HOST} npm run start:prod
