#!/bin/sh

stratoRoot=http://${stratoHost}/eth/v1.2
blocRoot=http://${blocHost}/bloc/v2.2
postgrestRoot=http://${postgrestHost}

echo "stratoRoot is: ${stratoRoot}"
echo "blocRoot is: ${blocRoot}"
echo "postgrestRoot is: ${postgrestRoot}"
echo "postgres_host, postgres_port are: ${postgres_host} ${postgres_port}"

echo "Waiting for STRATO to be available..."
until curl ${stratoRoot} >& /dev/null; do
    sleep 0.5
done
echo "STRATO is available"

echo "Waiting for bloc to be available..."
until curl ${blocRoot} >& /dev/null; do
    sleep 0.5
done
echo "bloc is available"

echo "Waiting for postgrest to be available..."
until curl ${postgrestRoot} >& /dev/null; do
    sleep 0.5
done
echo "postgrest is available"

echo 'Waiting for postgres to be available...'
while true; do
    curl ${postgres_host}:${postgres_port} > /dev/null 2>&1 || EXIT_CODE=$? && true
    if [ ${EXIT_CODE} = 52 ]; then
        break
    fi
    sleep 0.5
done
echo 'postgres is available'

# todo: check zookeeper connection explicitly

node /usr/lib/cirrus/main.js
