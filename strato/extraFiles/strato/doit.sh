#!/bin/bash

set -e
set -x

Green='\033[0;32m'
Red='\033[0;31m'
Yellow='\033[0;33m'
BYellow='\033[1;33m'
NC='\033[0m'

echo 'export PS1="⛓ \w> "' >> /root/.bashrc

declare -A MONITORED_PIDS
MONITORING_TIMER=5;

# Handle SIGTERM gracefully - forward to all monitored processes
cleanup() {
  echo "Received shutdown signal, stopping all processes..."
  for pid in "${!MONITORED_PIDS[@]}"; do
    if ps -p $pid > /dev/null 2>&1; then
      echo "Sending SIGTERM to ${MONITORED_PIDS[$pid]} (pid: $pid)"
      kill -TERM $pid 2>/dev/null || true
    fi
  done
  sleep 2
  for pid in "${!MONITORED_PIDS[@]}"; do
    if ps -p $pid > /dev/null 2>&1; then
      echo "Sending SIGKILL to ${MONITORED_PIDS[$pid]} (pid: $pid)"
      kill -KILL $pid 2>/dev/null || true
    fi
  done
  echo "Shutdown complete"
  exit 0
}
trap cleanup SIGTERM SIGINT
PSQL_CONNECTION_PARAMS="-h ${postgres_host} -p ${postgres_port} -U ${postgres_user}"

echo 'Waiting for Postgres to be available...'
until pg_isready ${PSQL_CONNECTION_PARAMS}
do
  echo "Check at $(date)"
  sleep 0.5
done
echo 'Postgres is available'
# Check if this container was initialized before
if [ ! -f _container_initialized ]; then
  # Check if need to wipe slipstream ("cirrus") db (NOT REQUIRED if in-place update with containers re-created and all volumes intact; REQUIRED in case of re-sync after --drop-chains)
  if [ ! -f /volume_data/_volume_initialized ]; then
    # drop slipstream db if already exists
    PGPASSWORD=${postgres_password} dropdb ${PSQL_CONNECTION_PARAMS} --if-exists ${postgres_slipstream_db}
    # Create the database for slipstream
    PGPASSWORD=${postgres_password} createdb ${PSQL_CONNECTION_PARAMS} ${postgres_slipstream_db}
    # Make sure the volume dir exists
    mkdir -p /volume_data
    date '+%Y-%m-%d %H:%M:%S' >  /volume_data/_volume_initialized
  fi
  # Create logs directory
  mkdir /logs
  # Create the '_container_initialized' sentinel file
  date '+%Y-%m-%d %H:%M:%S' > _container_initialized
fi

if [ -n "${network}" ]; then
  networkFlag="--network=${network}"
fi

# <Find the continuation of the script after the following function declarations>

function newnode {

  # if alternative log in methods are provided then use them
  mkdir -p logs

  echo "Checking if OAUTH parameters are available"
  if [[ -z ${OAUTH_CLIENT_ID} || -z ${OAUTH_CLIENT_SECRET} ]]; then
    echo "Could not obtain OAUTH parameters"
    exit 2
  elif [[ -z ${OAUTH_DISCOVERY_URL} ]]; then
    if [ "${network}" == "mercata-hydrogen" ] || [ "${networkID}" == "7596898649924658542" ]; then # connecting to testnet
      OAUTH_DISCOVERY_URL="https://keycloak.blockapps.net/auth/realms/mercata-testnet2/.well-known/openid-configuration"
    elif [ -n "${network}" -a "${network}" != "mercata" ] || [ -n "${networkID}" -a "${networkID}" != "6909499098523985262" ]; then # connecting to...not prod
      echo "OAUTH_DISCOVERY_URL was not provided and could not be derived"
      exit 3
    else
      OAUTH_DISCOVERY_URL="https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration"
    fi
  else
    echo "OAUTH parameters are available"
  fi

  mkdir -p secrets
  cat > secrets/oauth_credentials.yaml << EOF
discoveryUrl: "${OAUTH_DISCOVERY_URL}"
clientId: "${OAUTH_CLIENT_ID}"
clientSecret: "${OAUTH_CLIENT_SECRET}"
EOF

  if [[ ! -f .initialized ]] ; then
    # if node is being updated from the earlier version that did not have `.initialized` flag implemented (pre-7.0):
    if [[ -d .ethereumH && -d config && ! -f .initNotFinished ]]; then
      touch .initialized
      sleep 10
    else
      touch .initNotFinished
      cleanupDB
      doInit
      touch .initialized
      rm .initNotFinished
    fi
  else
    sleep 10
  fi

  echo "Starting Strato processes. All output is logged to $PWD/logs."

  # DEBUG LOGGING FLAGS
  apiDebugMode=LevelInfo
  seqMinLogLevel=LevelInfo
  slipMinLogLevel=LevelInfo
  vmMinLogLevel=LevelInfo
  p2pMinLogLevel=LevelInfo

  if ${API_DEBUG_LOG:-false} || ${FULL_DEBUG_LOG:-false}; 
  then apiDebugMode=LevelDebug
  fi

  if ${SEQUENCER_DEBUG_LOG:-false} || ${FULL_DEBUG_LOG:-false}; 
  then seqMinLogLevel=LevelDebug
  fi

  if ${SLIPSTREAM_DEBUG_LOG:-false} || ${FULL_DEBUG_LOG:-false}; 
  then slipMinLogLevel=LevelDebug
  fi

  if ${VM_DEBUG_LOG:-false} || ${FULL_DEBUG_LOG:-false}; 
  then vmMinLogLevel=LevelDebug
  fi

  if ${P2P_DEBUG_LOG:-false} || ${FULL_DEBUG_LOG:-false}; 
  then p2pMinLogLevel=LevelDebug
  fi

  if [ -n "${INSTRUMENTATION}" ]; then
      iFlag="+RTS -T -RTS"
  fi

  echo "Starting ethereum-discover"
  runBackgroundProcess ethereum-discover "${iFlag}" &>> logs/ethereum-discover

  echo "Starting strato-p2p"
  runBackgroundProcess strato-p2p \
     --minLogLevel=$p2pMinLogLevel \
     "${iFlag}" &>> logs/strato-p2p

  if [ -n "${strictBlockstanbul}" ]; then
      sBFlag="--strictBlockstanbul=${strictBlockstanbul}"
  fi

  echo "Starting strato-sequencer"
  runBackgroundProcess strato-sequencer \
    --minLogLevel=$seqMinLogLevel \
    --seq_max_events_per_iter=${seqMaxEventsPerIter:-500} \
    --seq_max_us_per_iter=${seqMaxUsPerIter:-50000} \
    --validatorBehavior=${validatorBehavior:-true} \
    --test_mode_bypass_blockstanbul=${test_mode_bypass_blockstanbul:-false} \
    "${iFlag}" "${sBFlag}" \
    +RTS "${seqRTSOPTs:-}" -N1 &>> logs/strato-sequencer

  echo "Starting strato-api-indexer"
  runBackgroundProcess strato-api-indexer "${iFlag}" +RTS -N1 >> logs/strato-api-indexer 2>&1

  echo "Starting strato-p2p-indexer"
  runBackgroundProcess strato-p2p-indexer "${iFlag}" +RTS -N1 >> logs/strato-p2p-indexer 2>&1

  if [ -n "${svmDev}" ]; then
    svdFlag="--svmDev=${svmDev}"
  fi
  if [ -n "${txSizeLimit}" ]; then
      txsFlag="--txSizeLimit=${txSizeLimit}"
  fi
  if [ -n "${gasLimit}" ]; then
      gasFlag="--gasLimit=${gasLimit}"
  fi
  if [ -n "${strictGas}" ]; then
      sgFlag="--strictGas=${strictGas}"
  fi
  if [ -n "${strictGasLimit}" ]; then
      sglFlag="--strictGasLimit=${strictGasLimit}"
  fi

  echo "Starting vm-runner"
  runBackgroundProcess vm-runner \
    --debug=${evmDebugMode:-false} \
    --debugEnabled=${VM_DEBUGGER:-false} \
    --debugPort=${debugPort:-8051} \
    --debugWSHost=${debugWSHost:-strato} \
    --debugWSPort=${debugWSPort:-8052} \
    --diffPublish=${diffPublish:-true} \
    --minLogLevel=${vmMinLogLevel} \
    --sqlDiff=${sqlDiff:-true} \
    --svmDev=${svmDev:-false} \
    --svmTrace=${svmTrace:-false} \
    "${iFlag}" \
    "${sgFlag}" \
    "${sglFlag}" \
    +RTS "${vmRunnerRTSOPTs:-}" -I2 -N1 &>> logs/vm-runner

  # Leave the +RTS -N1, it is important
  echo "Starting strato-api"
  runBackgroundProcess strato-api \
    --minLogLevel=$apiDebugMode \
    "${iFlag}" +RTS -N1 >> logs/strato-api 2>&1

  SLIPSTREAM_CMD="slipstream \
  --minLogLevel=${slipMinLogLevel} \
  ${iFlag}"

  echo "Starting slipstream"
  if [ "${SLIPSTREAM_OPTIONAL}" = true ]; then
      $SLIPSTREAM_CMD &>> logs/slipstream &
  else
      runBackgroundProcess $SLIPSTREAM_CMD &>> logs/slipstream
  fi

  echo "Starting process monitoring..."
  runBackgroundProcess process-monitor-exe "${iFlag}" &>> logs/process-monitoring

  echo "Configuring log rotation..."
  runBackgroundProcess logRotation

  set +x
  if [ ${PROCESS_MONITORING:-true} = true ] ; then
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

          FILE_NAME="/var/lib/strato/logs/$(echo ${DEAD_PROCESS} | cut -d ' ' -f 1)"
          echo "Tail of logs for crashed process:"
          echo "+tail -n 20 ${FILE_NAME}"
          tail -n 20 $FILE_NAME
          echo "End of logs."
          echo -e "${Red}STRATO IS DOWN: Process with pid ${monitored_pid} crashed so all background processes were killed. Check /var/lib/strato/logs/ in the container${NC}"
          # Keep container running idle
          tail -f /dev/null
        fi
      done
    done
  else
    echo -e "${BYellow}Process monitoring is off. Check the processes status with 'ps -ef' and see /var/lib/strato/logs/ directory in the container for logs${NC}"
    tail -f /dev/null
  fi
}

function cleanupDB {
  db_conn_params="-U ${pgUser} -h ${pgHost}"
  PGPASSWORD=$pgPass psql ${db_conn_params} -c "
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname like '%eth_%';"
  PGPASSWORD=$pgPass dropdb ${db_conn_params} --if-exists "bloc22"
  PGPASSWORD=$pgPass psql ${db_conn_params} -c "copy (select datname from pg_database where datname like '%eth_%') to stdout" | while read line; do
    echo "dropping the old db: $line"
    PGPASSWORD=$pgPass dropdb ${db_conn_params} "$line"
  done
}

function doInit {

  mkdir -p secrets
  echo -n "$pgPass" > secrets/postgres_password

  args="--addBootnodes=$addBootnodes \
  --apiIPAddress=0.0.0.0 \
  --generateKey=$generateKey \
  --kafkahost=$kafkaHost \
  --lazyblocks=${lazyBlocks:-true} \
  --minPeers=${numMinPeers:-100} \
  --pguser=$pgUser \
  --pghost=$pgHost \
  --redisHost=$redisBDBHost \
  --redisPort=$redisBDBPort \
  --redisDBNumber=${redisBDBNumber:-0} \
  --vaultUrl=${VAULT_URL}/strato/v2.3 \
  ${networkFlag} \
  ${stratoBootnode}"

  cmd="strato-setup $args"

  echo "init event source: $cmd"
  # logging to stdout and log file:
  $cmd 2>&1 | tee logs/strato-setup
  if [ ${PIPESTATUS[0]} -ne 0 ]; then
    echo "STRATO SETUP FAILED: see /var/lib/strato/logs/strato-setup for details"
    tail -f /dev/null
  fi

  echo "Running seed-genesis to create databases and topics..."
  seed-genesis 2>&1 | tee logs/seed-genesis
  if [ ${PIPESTATUS[0]} -ne 0 ]; then
    echo "SEED-GENESIS FAILED: see /var/lib/strato/logs/seed-genesis for details"
    tail -f /dev/null
  fi

  #we need to create the private key for the faucet
  mkdir config

  echo -ne "\x1d\xd8\x85\xa4\x23\xf4\xe2\x12\x74\x0f\x11\x6a\xfa\x66\xd4\x0a\xaf\xdb\xb3\xa3\x81\x07\x91\x50\x37\x18\x01\x87\x1d\x9e\xa2\x81" > config/priv
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

# If variable with name <arg 1> does not have non-empty value, set it to <arg 2>
# setEnv (var_name, default_value)
function setEnv {
  [[ -n ${!1} ]] || eval $1=$2
  echo "$1 = ${!1}"
}

echo "Processed environment variables:"
setEnv addBootnodes true
setEnv bootnode ""
setEnv kafkaHost ${kafkaHost}
setEnv pgUser ${postgres_user}
setEnv pgPass ${postgres_password}
setEnv pgHost ${postgres_host}
setEnv redisBDBHost ${redisHost}
setEnv redisBDBPort ${redisPort}
setEnv zkHost ${zkHost}
setEnv VAULT_URL "https://vault.blockapps.net:8093"

# TODO: the check is temporarily disabled until issues with urls are resolved
## This will check if the link provided is valid format, and if it is HTTPS
#if [[ "$VAULT_URL" == "https"* ]]; then
#    echo "VAULT_URL provided is using secure https connection."
#else
#    if [[ "$VAULT_URL" == *"172.17.0.1"* ]]; then
#        echo "VAULT_URL provided is http with local docker ip for debugging."
#    else
#        echo "VAULT_URL provided is not valid, expected the value starting with 'https://' or 'http://172.17.0.1'"
#        exit 3
#    fi
#fi

stratoBootnode=${bootnode:+--stratoBootnode=$bootnode}
[[ -n $bootnode ]] && addBootnodes=true
[[ -n $network ]] && addBootnodes=true

mkdir -p /var/lib/strato
cd /var/lib/strato

set +x
if [[ ${useCustomGenesis:-false} = "true" && ! -f "genesis.json" ]] ; then
  echo "useCustomGenesis is set to true - waiting for genesis.json to be added to $(pwd)/ path in the container... (Use: \`docker cp myGenesisFile.json strato-strato-1:$(pwd)/genesis.json\`)"
  while [ ! -f "genesis.json" ]; do
    sleep 1
  done
  echo "File genesis.json found! Continuing with the STRATO boot-up..."
fi
set -x

until nc -z $zkHost 2181 >&/dev/null
do  echo "Waiting for Zookeeper to become available"
    sleep 1
done

until nc -z $kafkaHost 9092 >&/dev/null
do  echo "Waiting for Kafka to become available"
    sleep 1
done

until PGPASSWORD=$pgPass psql -h "$pgHost" -U "$pgUser" -c '\l'; do
  >&2 echo "Waiting for Postgres to become available"
  sleep 1
done

# Main entry point
newnode
