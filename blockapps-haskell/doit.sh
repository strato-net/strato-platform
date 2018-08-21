#!/bin/bash

set -e
set -x

stratoRoot=http://${stratoHost}/eth/v1.2
vaultWrapperRoot=http://${vaultWrapperHost}/strato/v2.3

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
--stratourl=\$stratoRoot="${stratoRoot}"
--vaultwrapperurl=\$vaultWrapperRoot="${vaultWrapperRoot}"
--kafkahost=\$kafkaHost"${kafkaHost}"
--kafkaport=${kafkaPort}

strato-server:
no vars/flags set

bloc:
stratoHost="${stratoHost}"
vaultWrapperHost="${vaultWrapperHost}"
--stratourl=\$stratoRoot="${stratoRoot}"
--vaultwrapperurl=\$vaultWrapperRoot="${vaultWrapperRoot}"
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

echo "Waiting for Vault Wrapper to be available..."
until curl ${vaultWrapperRoot} >& /dev/null; do
    sleep 0.5
done
echo "Vault Wrapper is available"

echo 'Waiting for postgres to be available...'
while true; do
    curl ${postgres_host}:${postgres_port} > /dev/null 2>&1 || EXIT_CODE=$? && true
    if [ ${EXIT_CODE} = 52 ]; then
        break
    fi
    sleep 0.5
done

until nc -z $kafkaHost $kafkaPort >&/dev/null
do  echo "Waiting for Kafka to become available"
    sleep 1
done

PSQL_CONNECTION_PARAMS="-h ${postgres_host} -p ${postgres_port} -U ${postgres_user}"
# Check if this container was initialized before
if [ ! -f initialized ]; then
    # drop slipstream db if already exists
    PGPASSWORD=${postgres_password} dropdb ${PSQL_CONNECTION_PARAMS} --if-exists ${postgres_slipstream_db}
    # Create the database for slipstream
    PGPASSWORD=${postgres_password} createdb ${PSQL_CONNECTION_PARAMS} ${postgres_slipstream_db}
    # Create logs directory
    mkdir logs
    # Create the 'initialized' sentinel file
    date '+%Y-%m-%d %H:%M:%S' > initialized

fi

function forkSlipstream() {
  until curl localhost:8000; do
    sleep 1;
  done
  /usr/bin/slipstream --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" --password="$postgres_password" \
             --database="$postgres_slipstream_db"  --stratourl="$stratoRoot" --vaultwrapperurl="$vaultWrapperRoot" \
             --kafkahost="$kafkaHost" --kafkaport="$kafkaPort"
}


# TODO: refactor using the process monitoring from core-strato's doit.sh

/usr/bin/blockapps-strato-server >> logs/strato-server 2>&1 &

forkSlipstream &>> logs/slipstream &

/usr/bin/blockapps-bloc --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" --password="$postgres_password" \
           --stratourl="$stratoRoot" --vaultwrapperurl="$vaultWrapperRoot" --loglevel="${loglevel:-4}" +RTS -N1 2>&1
