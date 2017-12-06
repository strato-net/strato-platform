#!/usr/bin/env bash
set -e
set -x

export blocurl=${blocurl:-bloch:8000/bloc/v2.2}
export cirrusurl=${cirrusurl:-cirrus:3333}
export postgresurl=${postgresurl:-postgres:5432}
export stratourl=${stratourl:-strato:3000}

echo 'Waiting for bloc to be available...'
until curl --silent --output /dev/null --fail --location ${blocurl}
do
  sleep 1
done
echo 'bloc is available'

echo 'Waiting for strato to be available...'
until curl --silent --output /dev/null --fail --location ${stratourl}/eth/v1.2/uuid
do
  sleep 1
done
echo 'strato is available'

echo 'Waiting for cirrus to be available...'
until curl --silent --output /dev/null --fail --location ${cirrusurl}
do
  sleep 1
done
echo 'cirrus is available'

echo 'Waiting for postgres to be available...'
while true; do
    curl ${postgresurl} > /dev/null 2>&1 || EXIT_CODE=$? && true
    if [ ${EXIT_CODE} = 52 ]; then
        break
    fi
    sleep 1
done
echo 'postgres is available'

NODE_HOST=${NODE_HOST} npm run start:prod
