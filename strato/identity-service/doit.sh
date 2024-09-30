#!/bin/bash

set -ex

echo 'export PS1="⛓ \w> "' >> /root/.bashrc
CLIENT_ID=${CLIENT_ID}
CLIENT_SECRET=${CLIENT_SECRET}
OAUTH_DISCOVERY_URL=${OAUTH_DISCOVERY_URL}
PROCESS_MONITORING=${PROCESS_MONITORING:-true}
identityServicePort=${identityServicePort:-8014}
NODE_URL=${NODE_URL:-http://localhost:8080}
USER_REGISTRY_ADDRESS=${USER_REGISTRY_ADDRESS}
USER_REGISTRY_CODEHASH=${USER_REGISTRY_CODEHASH}
USER_CONTRACT_NAME=${USER_CONTRACT_NAME}
declare -A MONITORED_PIDS
MONITORING_TIMER=5;

mkdir -p /var/lib/identity
cd /var/lib/identity

function runIdentityServer {
  # if alternative log in methods are provided then use them
  mkdir -p logs
  
  minLogLevel=LevelInfo
  if [ "${IDENTITYSERVICE_DEBUG:-false}" == true ]; then
    minLogLevel=LevelDebug
  fi
  
  echo "Environment variables:
  identity-service:
  --minLogLevel=${minLogLevel} \
  --port="${identityServicePort}" \
  --nodeUrl=${NODE_URL} \
  --userRegistryAddress=${USER_REGISTRY_ADDRESS} \
  --userRegistryCodeHash=${USER_REGISTRY_CODEHASH} \
  --userContractName=${USER_CONTRACT_NAME}
  "
  RED='\033[0;31m'
  NC='\033[0m' # No Color
  
  echo "Running identity-service-server..."
  runBackgroundProcess identity-service-server \
    --minLogLevel=${minLogLevel} --port="${identityServicePort}" \
    --nodeUrl=${NODE_URL} \
    --userRegistryAddress=${USER_REGISTRY_ADDRESS} \
    --userRegistryCodeHash=${USER_REGISTRY_CODEHASH} \
    --CLIENT_ID=${CLIENT_ID} --CLIENT_SECRET=${CLIENT_SECRET} --OAUTH_DISCOVERY_URL=${OAUTH_DISCOVERY_URL} \
    --userContractName=${USER_CONTRACT_NAME} &>> logs/identity-service-server
  
  echo "Configuring log rotation..."
  runBackgroundProcess logRotation
  
  set +x
  if [ "${PROCESS_MONITORING}" = true ] ; then
    echo -e "${Green}Monitoring the background processes. Making checks every ${MONITORING_TIMER} sec. If you don't see any error messages below - all processes are healthy...${NC}"
    while sleep ${MONITORING_TIMER}; do
      # check status for every monitored process
      for monitored_pid in "${!MONITORED_PIDS[@]}"; do
        # if process with pid does not exist
        if ! (ps -p ${monitored_pid} > /dev/null); then
          DEAD_PROCESS=${MONITORED_PIDS[${monitored_pid}]}
          echo -e "${Red}Process ${DEAD_PROCESS} with pid ${monitored_pid} crashed - killing all monitored processes but keeping the container running...${NC}"
          # Kill all the rest of monitored processes
          for pid_to_kill in "${!MONITORED_PIDS[@]}"; do
            if ps -p ${pid_to_kill} > /dev/null; then
              echo "Sending SIGTERM to process ${MONITORED_PIDS[${pid_to_kill}]} (pid: ${pid_to_kill})"
              kill -TERM ${pid_to_kill} || true
              echo "done"
            fi
          done
          # Allow 10s for cleanup of processes
          sleep 10
          for pid_to_kill in "${!MONITORED_PIDS[@]}"; do
            if ps -p ${pid_to_kill} > /dev/null; then
              echo "Sending SIGKILL to process ${MONITORED_PID[${pid_to_kill}]} (pid: ${pid_to_kill})"
              kill -KILL ${pid_to_kill} || true
              echo "done"
            fi
          done
  
          FILE_NAME="/var/lib/identity/logs/$(echo ${DEAD_PROCESS} | cut -d ' ' -f 1)"
          echo "Tail of logs for crashed process:"
          echo "+tail -n 20 ${FILE_NAME}"
          tail -n 20 $FILE_NAME
          echo "End of logs."
          echo -e "${Red}IDENTITY SERVICE IS DOWN: Process with pid ${monitored_pid} crashed so all background processes were killed. Check /var/lib/identity/logs/ in the container${NC}"
          # Keep container running idle
          tail -f /dev/null
        fi
      done
    done
  else
    echo -e "${BYellow}Process monitoring is off. Check the processes status with 'ps -ef' and see /var/lib/identity/logs/ directory in the container for logs${NC}"
    tail -f /dev/null
  fi
}

# Find all logs greater than 10M, then copy and truncate
function logRotation {
  mkdir -p logs/rotation
  while true
  do
    sleep 900 ;
    find logs/ -maxdepth 1 -type f -size +10M -exec /bin/cp -rf {} logs/rotation/ \; -exec truncate -s 0 {} \;
    echo "Log files were rotated at $(date '+%Y-%m-%d %H:%M:%S')"
  done
}

function runBackgroundProcess {
  $@ &
  proc_pid=$!
  MONITORED_PIDS[${proc_pid}]=$@
  echo "process pid:: $proc_pid (command: $@)"
  disown %
}

runIdentityServer