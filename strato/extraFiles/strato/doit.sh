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

  echo "trying to see if the alternative OAUTH parameters are available"
  if [[ -z ${OAUTH_VAULT_PROXY_ALT_CLIENT_ID:-${OAUTH_CLIENT_ID}} || -z ${OAUTH_VAULT_PROXY_ALT_CLIENT_SECRET:-${OAUTH_CLIENT_SECRET}} ]]; then
    echo "Could not obtain OAUTH parameters for Vault Proxy"
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
    echo "OAUTH parameters for Vault Proxy are available"
  fi

  runBackgroundProcess blockapps-vault-proxy-server \
    --OAUTH_DISCOVERY_URL=${OAUTH_DISCOVERY_URL} \
    --OAUTH_CLIENT_ID=${OAUTH_CLIENT_ID} \
    --OAUTH_CLIENT_SECRET=${OAUTH_CLIENT_SECRET} \
    --OAUTH_RESERVE_SECONDS=${OAUTH_RESERVE_SECONDS:-13} \
    --VAULT_URL=${VAULT_URL} \
    --VAULT_PROXY_PORT=8013 \
    --VAULT_PROXY_DEBUG=${VAULT_PROXY_DEBUG:-false} &>> logs/vault-proxy

  set +x
  echo 'Waiting for vault-proxy to rise and shine at http://localhost:8013...'
  started=$(date +%s)
  timeout=30
  while ! curl --silent --output /dev/null --fail --max-time 0.5 --location http://localhost:8013; do
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
     --averageTxsPerBlock=${averageTxsPerBlock:-40} \
     --connectionTimeout=${connectionTimeout:-30} \
     --debugFail=${debugFail:-true}  \
     --maxConn=${maxConn:-1000} \
     --maxReturnedHeaders=${maxReturnedHeaders:-500} \
     --networkID=${networkID:--1} \
     --sqlPeers=true \
     --minLogLevel=$p2pMinLogLevel \
     ${networkFlag} "${iFlag}" &>> logs/strato-p2p

  if [ -n "${strictBlockstanbul}" ]; then
      sBFlag="--strictBlockstanbul=${strictBlockstanbul}"
  fi

  echo "Starting strato-sequencer"
  runBackgroundProcess strato-sequencer \
    --blockstanbul=true \
    --blockstanbul_block_period_ms=${blockstanbulBlockPeriodMs:-1000} \
    --blockstanbul_round_period_s=${blockstanbulRoundPeriodS:-120} \
    --genesisBlockName=${genesis:-gettingStarted} \
    --minLogLevel=$seqMinLogLevel \
    --seq_max_events_per_iter=${seqMaxEventsPerIter:-500} \
    --seq_max_us_per_iter=${seqMaxUsPerIter:-50000} \
    --validatorBehavior=${validatorBehavior:-true} \
    "${networkFlag}" "${iFlag}" "${sBFlag}" \
    +RTS "${seqRTSOPTs:-}" -N1 &>> logs/strato-sequencer

  echo "Starting strato-api-indexer"
  runBackgroundProcess strato-api-indexer "${iFlag}" +RTS -N1 >> logs/strato-api-indexer 2>&1

  echo "Starting strato-p2p-indexer"
  runBackgroundProcess strato-p2p-indexer "${iFlag}" +RTS -N1 >> logs/strato-p2p-indexer 2>&1

  echo "Starting strato-txr-indexer"
  runBackgroundProcess strato-txr-indexer "${iFlag}" +RTS -N1 >> logs/strato-txr-indexer 2>&1

  if [ -n "${svmDev}" ]; then
    svdFlag="--svmDev=${svmDev}"
  fi
  if [ -n "${accountNonceLimit}" ]; then
      aclFlag="--accountNonceLimit=${accountNonceLimit}"
  fi
  if [ -n "${txSizeLimit}" ]; then
      txsFlag="--txSizeLimit=${txSizeLimit}"
  fi
  if [ -n "${gasLimit}" ]; then
      gasFlag="--gasLimit=${gasLimit}"
  fi
  if [ -n "${creatorForkBlockNumber}" ]; then
      creatorFlag="--creatorForkBlockNumber=${creatorForkBlockNumber}"
  fi
  if [ -n "${idServerUrl}" ]; then
      idServer="--identityServerUrl=${idServerUrl}"
  fi
  if [ -n "${userRegistryAddress}" ]; then
      urFlag="--userRegistryAddress=${userRegistryAddress}"
  fi
  if [ -n "${userRegistryCodeHash}" ]; then
      ucFlag="--userRegistryCodeHash=${userRegistryCodeHash}"
  fi
  if [ -n "${useBuiltinUserRegistry}" ]; then
      ubFlag="--useBuiltinUserRegistry=${useBuiltinUserRegistry}"
  fi
  if [ -n "${useWalletsByDefault}" ]; then
      udFlag="--useWalletsByDefault=${useWalletsByDefault}"
  fi
  if [ -n "${FILE_SERVER_URL}" ]; then
      fsFlag="--fileServerUrl=${FILE_SERVER_URL}"
  fi
  if [ -n "${NOTIFICATION_SERVER_URL}" ]; then
      nsFlag="--notificationServerUrl=${NOTIFICATION_SERVER_URL}"
  fi
  if [ -n "${strictGas}" ]; then
      sgFlag="--strictGas=${strictGas}"
  fi
  if [ -n "${strictGasLimit}" ]; then
      sglFlag="--strictGasLimit=${strictGasLimit}"
  fi

  echo "Starting vm-runner"
  runBackgroundProcess vm-runner \
    --blockstanbul=true \
    --debug=${evmDebugMode:-false} \
    --debugEnabled=${VM_DEBUGGER:-false} \
    --debugPort=${debugPort:-8051} \
    --debugWSHost=${debugWSHost:-strato} \
    --debugWSPort=${debugWSPort:-8052} \
    --diffPublish=${diffPublish:-true} \
    --maxTxsPerBlock=${maxTxsPerBlock:-500} \
    --minLogLevel=${vmMinLogLevel} \
    --networkID=${networkID:--1} \
    --seqEventsBatchSize=${seqEventsBatchSize:--1} \
    --seqEventsCostHeuristic=${seqEventsCostHeuristic:-20000} \
    --sqlDiff=${sqlDiff:-true} \
    --svmDev=${svmDev:-false} \
    --svmTrace=${svmTrace:-false} \
    --requireCerts=${requireCerts:-true} \
    ${networkFlag} \
    "${aclFlag}" \
    "${txsFlag}" \
    "${gasFlag}" \
    "${creatorFlag}" \
    "${iFlag}" \
    "${sgFlag}" \
    "${sglFlag}" \
    +RTS "${vmRunnerRTSOPTs:-}" -I2 -N1 &>> logs/vm-runner

  # Leave the +RTS -N1, it is important
  echo "Starting strato-api"
  runBackgroundProcess strato-api \
    --minLogLevel=$apiDebugMode \
    --networkID=${networkID:--1} \
    --vaultUrl=${VAULT_URL} \
    --oauthDiscoveryUrl=${OAUTH_DISCOVERY_URL} \
    "${networkFlag}" \
    "${aclFlag}" \
    "${txsFlag}" \
    "${gasFlag}" \
    "${idServer}" \
    "${urFlag}" \
    "${ucFlag}" \
    "${ubFlag}" \
    "${udFlag}" \
    "${fsFlag}" \
    "${nsFlag}" \
    "${iFlag}" +RTS -N1 >> logs/strato-api 2>&1

  SLIPSTREAM_CMD="slipstream \
  --database=${postgres_slipstream_db} \
  --kafkahost=${kafkaHost} \
  --kafkaport=${kafkaPort} \
  --minLogLevel=${slipMinLogLevel} \
  --pghost=${postgres_host} \
  --pgport=${postgres_port} \
  --pguser=${postgres_user} \
  --password=${postgres_password} \
  --stratourl=http://localhost:3000/eth/v1.2 \
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

  args="--addBootnodes=$addBootnodes \
  --blockTime=${blockTime:-13} \
  --genesisBlockName=${genesis:-gettingStarted} \
  --generateKey=$generateKey \
  --kafka=./kafka-topics.sh \
  --kafkahost=$kafkaHost \
  --lazyblocks=${lazyBlocks:-true} \
  --minPeers=${numMinPeers:-100} \
  --minBlockDifficulty=${minBlockDifficulty:-131072} \
  --pguser=$pgUser \
  --password=$pgPass \
  --pghost=$pgHost \
  --redisHost=$redisBDBHost \
  --redisPort=$redisBDBPort \
  --redisDBNumber=${redisBDBNumber:-0} \
  --zkhost=$zkHost \
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
setEnv genesisBlock ""
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

if [[ -n $genesisBlock ]]
then echo "$genesisBlock" > ${genesis:-gettingStarted}Genesis.json
fi

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
