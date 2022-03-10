#!/bin/bash

set -e
set -x

echo 'export PS1="⛓ \w> "' >> /root/.bashrc

PROCESS_MONITORING=${PROCESS_MONITORING:-true}
declare -A MONITORED_PIDS
MONITORING_TIMER=5;

stratoRoot=http://${stratoHost}/eth/v1.2

vaultWrapperRoot=http://${vaultWrapperHost}/strato/v2.3

slipMinLogLevel=LevelInfo
if [ "${SLIPSTREAM_DEBUG:-false}" == true ] ; then
  slipMinLogLevel=LevelDebug
fi

PSQL_CONNECTION_PARAMS="-h ${postgres_host} -p ${postgres_port} -U ${postgres_user}"
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


function newnode {

  if [[ ! -f .initialized ]] ; then
    # if node is being updated from the earlier version that did not have `.initialized` flag implemented (pre-7.0):
    if [[ -d .ethereumH && -d config && ! -f .initNotFinished ]]; then
      touch .initialized
      sleep 10
    else
      touch .initNotFinished
      mkdir logs
      cleanupDB
      doInit
      touch .initialized
      rm .initNotFinished
    fi
  else
    sleep 10
  fi

  echo "Starting Strato processes. All output is logged to $PWD/logs."
  runBackgroundProcess logserver --directory "${PWD}/logs" --uri_root=/logs/strato/ &>> logs/logserver

  if $mineBlocks
  then echo "Starting strato-adit"
      aMiner=$miningAlgorithm
      if [ $blockstanbul = true ]; then
        aMiner=Instant
      fi
      export miningThreads=${miningThreads:-1}
      runBackgroundProcess strato-adit --useSyncMode=$useSyncMode --minQuorumSize=$minQuorumSize --threads=${miningThreads:-1} --aMiner=$aMiner >> logs/strato-adit 2>&1
  fi

  echo "Starting ethereum-discover"
  runBackgroundProcess ethereum-discover --vaultWrapperUrl=$vaultWrapperRoot &>> logs/ethereum-discover

  actualTimeout="${connectionTimeout:-300}"
  if [ -n "${blockstanbulRoundPeriodS}" ]; then
    withCushion=$(( 2 * blockstanbulRoundPeriodS ))
    actualTimeout=$(( actualTimeout > withCushion ? actualTimeout : withCushion ))
  fi

  if [[ -n "${blockstanbul}" || -n "${txGossipFanout}" ]]; then
    txgFlag="--txGossipFanout=${txGossipFanout:-3}"
  fi
  if [ -n "${averageTxsPerBlock}" ]; then
    atbFlag="--averageTxsPerBlock=${averageTxsPerBlock}"
  fi
  if [ -n "${privateChainAuthorizationMode}" ]; then
    pcamFlag="--privateChainAuthorizationMode=${privateChainAuthorizationMode}"
  fi
  if [ -n "${participationMode}" ]; then
    pmFlag="--participationMode=${participationMode}"
  fi
  if [ -n "${wireMessageCacheSize}" ]; then
    cacheFlag="--wireMessageCacheSize=${wireMessageCacheSize}"
  fi
  if [ -n "${network}" ]; then
    networkFlag="--network=${network}"
  fi

  echo "Starting strato-p2p"
  runBackgroundProcess strato-p2p \
     --connectionTimeout=$actualTimeout \
     --sqlPeers=true \
     --debugFail=${debugFail:-true}  \
     --maxConn=$maxConn \
     --maxReturnedHeaders=$maxReturnedHeaders \
     --networkID=$networkID \
     --vaultWrapperUrl=$vaultWrapperRoot \
     ${txgFlag} \
     ${atbFlag} \
     ${pcamFlag} \
     ${pmFlag} \
     ${cacheFlag} \
     ${networkFlag} \
     &>> logs/strato-p2p

  evmMinLogLevel=LevelInfo
  if [ "${evmDebugMode}" = true ] ; then
     evmMinLogLevel=LevelDebug
  fi
  seqMinLogLevel=LevelInfo
  if [ "${seqDebugMode}" = true ] ; then
     seqMinLogLevel=LevelDebug
  fi

  echo "Starting strato-sequencer"
  if [ -n "${blockstanbul}" ]; then
    tbFlag="--blockstanbul=${blockstanbul}"
  fi
  if [ -n "${blockstanbulBlockPeriodMs}" ]; then
    bpFlag="--blockstanbul_block_period_ms=${blockstanbulBlockPeriodMs}"
  fi
  if [ -n "${blockstanbulRoundPeriodS}" ]; then
    rpFlag="--blockstanbul_round_period_s=${blockstanbulRoundPeriodS}"
  fi
  if [ -n "${validators}" ]; then
    vsFlag="--validators=${validators}"
  fi
  if [ -n "${seqMaxEventsPerIter}" ]; then
    evsFlag="--seq_max_events_per_iter=${seqMaxEventsPerIter}"
  fi
  if [ -n "${seqMaxUsPerIter}" ]; then
    usFlag="--seq_max_us_per_iter=${seqMaxUsPerIter}"
  fi
  if [ -n "${blockstanbulAdmins}" ]; then
    baFlag="--blockstanbul_admins=${blockstanbulAdmins}"
  fi

  adFlag="--isAdmin=${isAdmin}"
  rtFlag="--isRootNode=${isRootNode}"
  vwFlag="--vaultWrapperUrl=${vaultWrapperRoot}"

  runBackgroundProcess strato-sequencer \
    "${bpFlag}" "${rpFlag}" "${tbFlag}" "${evsFlag}" "${usFlag}" "${vsFlag}" \
    "${baFlag}" "${scFlag}" "${adFlag}" "${rtFlag}" --minLogLevel=$seqMinLogLevel \
    "${networkFlag}" \
    "${vwFlag}" +RTS "${seqRTSOPTs:-}" -N1 &>> logs/strato-sequencer

  echo "Starting strato-api-indexer"
  runBackgroundProcess strato-api-indexer +RTS -N1 >> logs/strato-api-indexer 2>&1

  echo "Starting strato-p2p-indexer"
  runBackgroundProcess strato-p2p-indexer +RTS -N1 >> logs/strato-p2p-indexer 2>&1

  echo "Starting strato-txr-indexer"
  runBackgroundProcess strato-txr-indexer +RTS -N1 >> logs/strato-txr-indexer 2>&1

  if [ -n "${brokenRefundReenable}" ]; then
    breFlag="--brokenRefundReenable=${brokenRefundReenable}"
  fi
  if [ -n "${svmDev}" ]; then
    svdFlag="--svmDev=${svmDev}"
  fi
  if [ -n "${seqEventsBatchSize}" ]; then
    sebFlag="--seqEventsBatchSize=${seqEventsBatchSize}"
  fi
  if [-n "${seqEventsCostHeuristic}" ]; then
      sechFlag="--seqEventsCostHeuristic=${seqEventsCostHeuristic}"
  fi
  if [-n "${cacheTransactionResults}"] ; then
      ctrFlag="--cacheTransactionResults=${cacheTransactionResults}"
  fi
  echo "Starting vm-runner"
  runBackgroundProcess vm-runner --useSyncMode=$useSyncMode --miner=$miningAlgorithm --maxTxsPerBlock=$maxTxsPerBlock \
                         --diffPublish=$diffPublish --sqlDiff=$sqlDiff --svmTrace=$svmTrace --createTransactionResults=true \
                         --miningVerification=$verifyBlocks --difficultyBomb=$difficultyBomb \
                         --debugEnabled=$vmDebug --wsDebug=$wsDebug \
                         --debugPort=$debugPort --debugWSPort=$debugWSPort \
                         --trace=$evmTraceMode --debug=$evmDebugMode --minLogLevel=$evmMinLogLevel --evmCompatible=$evmCompatible \
                         ${networkFlag} --networkID=$networkID \
                         "${tbFlag}" "${breFlag}" "${sebFlag}" "${sechFlag}" "${svdFlag}" "${ctrFlag}" \
                         --gasOn=$gasOn +RTS "${vmRunnerRTSOPTs:-}" -N1 &>> logs/vm-runner
  
  echo "Starting strato-api"
  runBackgroundProcess strato-api --gasOn=$gasOn --evmCompatible=$evmCompatible +RTS -N1 >> logs/strato-api 2>&1

  if [ "${START_EXPERIMENTAL_STRATO_API}" = true ]; then
      echo "Starting strato-api2"
      runBackgroundProcess strato-api2 --gasOn=$gasOn +RTS -N1 >> logs/strato-api2 2>&1
  fi

  SLIPSTREAM_CMD="slipstream --pghost=${postgres_host} --pgport=${postgres_port} \
    --pguser=${postgres_user} --password=${postgres_password} --database=${postgres_slipstream_db} \
    --stratourl=${stratoRoot} --vaultwrapperurl=${vaultWrapperRoot}  \
    --kafkahost=${kafkaHost} --kafkaport=${kafkaPort} --minLogLevel=${slipMinLogLevel} --indexEVM=${indexEVM}"

  if [ ${SLIPSTREAM_OPTIONAL} = true ]; then
      $SLIPSTREAM_CMD &>> logs/slipstream &
  else
      runBackgroundProcess $SLIPSTREAM_CMD &>> logs/slipstream
  fi
  
  echo "Configuring log rotation..."
  runBackgroundProcess logRotation

  set +x
  if [ "${PROCESS_MONITORING}" = true ] ; then
    echo "Monitoring the background processes. Making checks every ${MONITORING_TIMER} sec. If you don't see any error messages below - all processes are healthy..."
    while sleep ${MONITORING_TIMER}; do
      # check status for every monitored process
      for monitored_pid in "${!MONITORED_PIDS[@]}"; do
        # if process with pid does not exist
        if ! (ps -p ${monitored_pid} > /dev/null); then
          DEAD_PROCESS=${MONITORED_PIDS[${monitored_pid}]}
          echo "Process ${DEAD_PROCESS} with pid ${monitored_pid} crashed - killing all monitored processes but keeping the container running..."
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
          echo "STRATO IS DOWN: Process with pid ${monitored_pid} crashed so all background processes were killed. Check /var/lib/strato/logs/ in the container"
          # Keep container running idle
          tail -f /dev/null
        fi
      done
    done
  else
    echo "Process monitoring is off. Check the processes status with 'ps -ef' and see /var/lib/strato/logs/ directory in the container for logs"
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
  blockTime=${blockTime:-13}
  minBlockDifficulty=${minBlockDifficulty:-131072}
  if [ -n "${network}" ]; then
    networkFlag="--network=${network}"
  fi

  args="--pguser=$pgUser --password=$pgPass --genesisBlockName=$genesis --kafka=./kafka-topics.sh \
        --pghost=$pgHost --kafkahost=$kafkaHost --zkhost=$zkHost --lazyblocks=$lazyBlocks \
        --redisHost=$redisBDBHost --redisPort=$redisBDBPort --redisDBNumber=$redisBDBNumber \
        --addBootnodes=$addBootnodes $stratoBootnode --vaultWrapperUrl=$vaultWrapperRoot \
        --blockTime=$blockTime --minPeers=$numMinPeers --minBlockDifficulty=$minBlockDifficulty \
        --generateKey=$generateKey --extraFaucets=$extraFaucets ${networkFlag}"

  if ${splitinit:-false} ; then
    #TODO(https://blockapps.atlassian.net/browse/STRATO-1421): Populate strato-init-events with from-restore from S3
    cmd="tabula-rasa $args"

    echo "init event source: $cmd"
    # logging to stdout and log file:
    $cmd 2>&1 | tee logs/strato-setup
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
      echo "STRATO SETUP FAILED: see /var/lib/strato/logs/strato-setup for details"
      tail -f /dev/null
    fi
    init-worker --kafkahost=$kafkaHost 2>&1 | tee --append logs/strato-setup
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
      echo "STRATO SETUP FAILED: see /var/lib/strato/logs/strato-setup for details"
      tail -f /dev/null
    fi
  else
    cmd="strato-setup $args"

    echo "strato-setup command: $cmd"
    # logging to stdout and log file:
    $cmd 2>&1 | tee logs/strato-setup
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
      echo "STRATO SETUP FAILED: see /var/lib/strato/logs/strato-setup for details"
      tail -f /dev/null
    fi
  fi

  if [ "${USE_OLD_STRATO_API}" != "true" ]; then
      echo "initializing bloc database"
      strato-api-init
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

function rmEthereumH {
  rm -rf .ethereumH/
}

#trap rmEthereumH EXIT

function setEnv {
  [[ -n ${!1} ]] || eval $1=$2
  echo "$1 = ${!1}"
}

echo "Environment variables:"

setEnv pgUser ${postgres_user}
setEnv pgPass ${postgres_password}
setEnv pgHost ${postgres_host}

setEnv kafkaHost ${kafkaHost}
setEnv zkHost ${zkHost}

setEnv redisBDBHost ${redisHost}
setEnv redisBDBPort ${redisPort}
setEnv redisBDBNumber 0

setEnv genesis gettingStarted
setEnv miningAlgorithm Instant
setEnv maxTxsPerBlock 500

if [ -z $network ]
then
    setEnv networkID 6
else
    setEnv networkID -1
fi
setEnv genesisBlock ""
setEnv bootnode ""
setEnv maxReturnedHeaders 1000

setEnv mineBlocks true
setEnv verifyBlocks false
setEnv instantMining true
setEnv lazyBlocks true
setEnv addBootnodes false
setEnv numMinPeers 0
setEnv useSyncMode false
setEnv minQuorumSize 1
setEnv maxConn 20
setEnv difficultyBomb false

setEnv sqlDiff ${sqlDiff:-true}
setEnv svmTrace ${svmTrace:-false}
setEnv diffPublish true

setEnv evmCompatible ${EVM_COMPATIBLE:-false}
if [ "${evmCompatible}" = true ]
then
  setEnv indexEVM true
else
  setEnv indexEVM ${indexEVM:-false}
fi
setEnv evmDebugMode false
setEnv evmTraceMode false

setEnv vmDebug ${vmDebug:-false}
setEnv wsDebug ${wsDebug:-false}
setEnv debugPort ${debugPort:-8051}
setEnv debugWSPort ${debugWSPort:-8052}


stratoBootnode=${bootnode:+--stratoBootnode=$bootnode}
[[ -n $bootnode ]] && addBootnodes=true
[[ -n $network ]] && addBootnodes=true

mkdir -p /var/lib/strato
cd /var/lib/strato

if [[ -n $genesisBlock ]]
then echo "$genesisBlock" > ${genesis}Genesis.json
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

global-db --pghost $pgHost || { echo "Ignoring."; true; } # If it fails, it just means we already created the global db
newnode
