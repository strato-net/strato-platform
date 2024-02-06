#!/bin/bash

set -ex

echo 'export PS1="⛓ \w> "' >> /root/.bashrc

PROCESS_MONITORING=${PROCESS_MONITORING:-true}
identityProviderPort=${identityProviderPort:-8014}
declare -A MONITORED_PIDS
MONITORING_TIMER=5;

mkdir -p /var/lib/identity
cd /var/lib/identity

function runIdentityServer {
  # if alternative log in methods are provided then use them
  mkdir -p logs
  
  minLogLevel=LevelInfo
  if [ "${IDENTITYPROVIDER_DEBUG:-false}" == true ]; then
    minLogLevel=LevelDebug
  fi
  
  echo "Environment variables:
  identity-provider:
  --minLogLevel="${minLogLevel}" \
  --port="${identityProviderPort}"
  --vaultProxyUrl="${vaultProxyUrl}"
  "
  
  if [ -n "${vaultProxyUrl}" ]; then
      vpFlag="--vaultProxyUrl=${vaultProxyUrl}"
  fi
  if [ -n "${SENDGRID_APIKEY}" ]; then
      sgFlag="--SENDGRID_APIKEY=${SENDGRID_APIKEY}"
  fi
  if [ -n "${cacheSize}" ]; then
      csFlag="--cacheSize=${cacheSize}"
  fi  
  RED='\033[0;31m'
  NC='\033[0m' # No Color
  OAUTH_DISCOVERY_URL=$(yq '.[0].discoveryUrl // "" ' /identity-provider/idconf.yaml )
  OAUTH_CLIENT_ID=$(yq '.[0].clientId // "" ' /identity-provider/idconf.yaml )
  OAUTH_CLIENT_SECRET=$(yq '.[0].clientSecret // "" ' /identity-provider/idconf.yaml )

  if [[ -z ${OAUTH_DISCOVERY_URL} || -z ${OAUTH_CLIENT_ID} || -z ${OAUTH_CLIENT_SECRET} ]]; then
    echo "FATAL ERROR: You MUST provide details for at least one OAuth realm in idconf.yaml, including the discoveryUrl, clientId, and clientSecret"
    exit 1
  fi

  runBackgroundProcess blockapps-vault-proxy-server \
    --OAUTH_DISCOVERY_URL=${OAUTH_DISCOVERY_URL} --OAUTH_CLIENT_ID=${OAUTH_CLIENT_ID} \
    --OAUTH_CLIENT_SECRET=${OAUTH_CLIENT_SECRET} ${vporsFlag} --VAULT_URL=${VAULT_URL} \
    --VAULT_PROXY_PORT=8013 --VAULT_PROXY_DEBUG=${VAULT_PROXY_DEBUG:-false} &>> logs/vault-proxy
  
  set +x
  echo 'Waiting for vault-proxy to rise and shine at http://localhost:8013...'
  started=$(date +%s)
  timeout=30
  while ! curl --silent --output /dev/null --fail --max-time 0.2 --location http://localhost:8013; do
    if [[ $(date +%s) -ge ${started}+${timeout} ]]; then
      echo -e "\n tail -n40 logs/vault-proxy"
      tail -n40 logs/vault-proxy
      echo -e "\n${Red}vault-proxy takes too long to start. It most probably failed. Check the tail of the vault-proxy log above. Sleeping now.${NC}"
      sleep 60
    fi
    sleep 0.3
  done
  echo 'vault-proxy is available'
  set -x
  
  echo "Running identity-provider-server..."
  runBackgroundProcess identity-provider-server \
    --minLogLevel=${minLogLevel} --port="${identityProviderPort}" \
    "${vpFlag}" "${sgFlag}" "${csFlag}" &>> logs/identity-provider-server
  
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
          echo -e "${Red}IDENTITY PROVIDER IS DOWN: Process with pid ${monitored_pid} crashed so all background processes were killed. Check /var/lib/identity/logs/ in the container${NC}"
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