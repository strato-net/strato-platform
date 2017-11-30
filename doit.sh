#!/bin/sh

stratourl=${stratourl:-http://strato:3000}
blocurl=${blocurl:-http://bloch:8000/bloc/v2.2}
postgres_host=${postgres_host:-postgres}
postgres_port=${postgres_port:-5432}

echo "stratourl is: ${stratourl}"
echo "blocurl is: ${blocurl}"
echo "postgres_host, postgres_port are: ${postgres_host}" ${postgres_port}

echo "Waiting for STRATO to be available..."
until curl ${stratourl} >& /dev/null; do
    sleep 0.5
done
echo "STRATO is available"

echo "Waiting for bloc to be available..."
until curl ${blocurl} >& /dev/null; do
    sleep 0.5
done
echo "bloc is available"

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
