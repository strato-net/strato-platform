#!/bin/bash

set -e
set -x

PROCESS_MONITORING=${PROCESS_MONITORING:-true}
declare -A MONITORED_PIDS
MONITORING_TIMER=5;

stratoRoot=http://${stratoHost}/eth/v1.2
vaultWrapperRoot=http://${vaultWrapperHost}/strato/v2.3

isPublic=false
 if [ "${SMD_MODE}" == public ]; then
   isPublic=true
 fi

read enableHistory < usr/bin/bloc/history.txt                          
echo "History list: $enableHistory"

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

function runBackgroundProcess {
  $@ &
  proc_pid=$!
  MONITORED_PIDS[${proc_pid}]=$@
  echo "process pid:: $proc_pid (command: $@)"
  disown %
}

runBackgroundProcess /usr/bin/blockapps-strato-server >> logs/strato-server 2>&1

runBackgroundProcess /usr/bin/blockapps-bloc --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" --password="$postgres_password" \
           --stratourl="$stratoRoot" --vaultwrapperurl="$vaultWrapperRoot" --loglevel="${loglevel:-4}" +RTS -N1 &>> logs/bloc

until curl localhost:8000 &> /dev/null; do
  echo "Slipstream is waiting for bloc to come up..."
  sleep 1;
done
echo "Bloc is up - running slipstream now..."

runBackgroundProcess /usr/bin/slipstream --pghost="$postgres_host" --pgport="$postgres_port" --pguser="$postgres_user" --password="$postgres_password" \
           --database="$postgres_slipstream_db"  --stratourl="$stratoRoot" --vaultwrapperurl="$vaultWrapperRoot" \
           --kafkahost="$kafkaHost" --kafkaport="$kafkaPort" --historyList="$enableHistory" &>> logs/slipstream

set +x
if [ "${PROCESS_MONITORING}" = true ] ; then
  echo "Monitoring the background processes. Making checks every ${MONITORING_TIMER} sec. If you don't see any error messages below - all processes are healthy..."
  while sleep ${MONITORING_TIMER}; do
    # check status for every monitored process
    for monitored_pid in "${!MONITORED_PIDS[@]}"; do
      # if process with pid does not exist
      if ! (ps -p ${monitored_pid} > /dev/null); then
        echo "Process ${MONITORED_PIDS[${monitored_pid}]} with pid ${monitored_pid} crashed - killing all monitored processes but keeping the container running..."
        # Kill all the rest of monitored processes
        for pid_to_kill in "${!MONITORED_PIDS[@]}"; do
          if ps -p ${pid_to_kill} > /dev/null; then
            echo "killing process ${MONITORED_PIDS[${pid_to_kill}]} (pid: ${pid_to_kill})"
            kill -9 ${pid_to_kill} || true
            echo "done"
          fi
        done
        echo "CONTAINER IS DOWN: Process with pid ${monitored_pid} crashed so all background processes were killed. Check /logs/ in the container"
        # Keep container running idle
        tail -f /dev/null
      fi
    done
  done
else
  echo "Process monitoring is off. Check the processes status with 'ps -ef' and see /logs/ directory in the container for logs"
  tail -f /dev/null
fi
