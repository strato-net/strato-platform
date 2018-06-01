#!/bin/bash

set -e
set -x

stratoRoot=http://${stratoHost}/eth/v1.2
cirrusRoot=http://${cirrusHost}

isPublic=false
if [ "${SMD_MODE}" == public ]; then
  isPublic=true
fi

echo "Environment variables:
slipstream:
--pghost=\$postgres_host="${postgres_host}"
--pgport=\$postgres_port="${postgres_port}"
--pguser=\$postgres_user="${postgres_user}"
--password=\$postgres_password="${postgres_password}"
--database=\$postgres_slipstream_db="${postgres_slipstream_db}"

strato-server:
no vars/flags set

bloc:
stratoHost="${stratoHost}"
--cirrusurl=\$cirrusHost="${cirrusHost}"
--stratourl=\$stratoRoot="${stratoRoot}"
--pghost=\$postgres_host="${postgres_host}"
--pgport=\$postgres_port="${postgres_port}"
--pguser=\$postgres_user="${postgres_user}"
--password=\$postgres_password="${postgres_password}"
--loglevel=\$loglevel="${loglevel:-4}"
"

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

mkdir logs

# TODO: refactor bloc (and monstrato) dockerization using supervisord for more process control, log aggregation and health monitoring

/usr/bin/blockapps-strato-server >> logs/strato-server 2>&1 &

# TODO: add kafka/zk connection flags to run slipstream (when slipstream supports them) and may be others (strato? bloc?..)
/usr/bin/slipstream --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" --password="$postgres_password" \
            --database="$postgres_slipstream_db"  --topicname="$topic_name" >> logs/slipstream 2>&1 &

/usr/bin/blockapps-bloc --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" --password="$postgres_password" \
            --stratourl="$stratoRoot" --loglevel="${loglevel:-4}" --cirrusurl="$cirrusRoot" +RTS -N1 2>&1
