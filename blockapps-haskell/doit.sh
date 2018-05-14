#!/bin/bash

set -e
set -x

stratoRoot=http://${stratoHost}/eth/v1.2
cirrusRoot=http://${cirrusHost}

echo "Environment variables:
stratoHost=${stratoHost}
--cirrusurl=cirrusHost=${cirrusHost}
--stratourl=stratoRoot=${stratoRoot}
--pghost=postgres_host=${postgres_host}
--pgport=postgres_port=${postgres_port}
--pguser=postgres_user=${postgres_user}
--password=postgres_password=${postgres_password}
--loglevel=loglevel=${loglevel:-4}
"

blocserver="/usr/bin/blockapps-bloc"
stratoserver="/usr/bin/blockapps-strato-server"
locale-gen "en_US.UTF-8"
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8

echo "Waiting for STRATO to be available..."
until curl ${stratoRoot} >& /dev/null; do
    sleep 0.5
done
echo "STRATO is available"

echo 'Waiting for postgres to be available...'
while true; do
    curl ${postgres_host}:${postgres_port} > /dev/null 2>&1 || EXIT_CODE=$? && true
    if [ ${EXIT_CODE} = 52 ]; then
        break
    fi
    sleep 0.5
done

$stratoserver &

$blocserver --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" --password="$postgres_password" \
            --stratourl="$stratoRoot" --loglevel="${loglevel:-4}" --cirrusurl="$cirrusRoot" +RTS -N1 2>&1
