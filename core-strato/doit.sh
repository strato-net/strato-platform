#!/bin/bash

set -e
set -x

PROCESS_MONITORING=${PROCESS_MONITORING:-true}
declare -A MONITORED_PIDS
MONITORING_TIMER=5;

vaultWrapperRoot=http://${vaultWrapperHost}/strato/v2.3


function newnode {

  if [[ ! -d .ethereumH ]] ; then
    mkdir logs
    cleanupDB
    doInit
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
                         --trace=$evmTraceMode --debug=$evmDebugMode --minLogLevel=$evmMinLogLevel \
                         "${tbFlag}" "${breFlag}" "${sebFlag}" "${sechFlag}" "${svdFlag}" "${ctrFlag}" \
                         --gasOn=$gasOn +RTS "${vmRunnerRTSOPTs:-}" -N1 &>> logs/vm-runner

  if [ "${USE_OLD_STRATO_API}" = true ]; then
      echo "Starting core-api"
      runBackgroundProcess core-api --appFetchLimit=${appFetchLimit:-100} >> logs/core-api 2>&1
  else
      echo "Starting strato-api"
      runBackgroundProcess strato-api --gasOn=$gasOn >> logs/strato-api 2>&1
  fi

  if [ "${START_EXPERIMENTAL_STRATO_API}" = true ]; then
      echo "Starting strato-api2"
      runBackgroundProcess strato-api2 --gasOn=$gasOn >> logs/strato-api2 2>&1
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
  echo -en '\x01\x01\x00\x00\x00\x00\x00\x00\x00\x20\x81\xa2\x9e\x1d\x87\x01\x18\x37\x50\x91\x07\x81\xa3\xb3\xdb\xaf\x0a\xd4\x66\xfa\x6a\x11\x0f\x74\x12\xe2\xf4\x23\xa4\x85\xd8\x1d' > config/priv
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

setEnv evmDebugMode false
setEnv evmTraceMode false

setEnv vmDebug=${vmDebug:-false}
setEnv wsDebug=${wsDebug:-false}
setEnv debugPort=${debugPort:-8051}
setEnv debugWSPort=${debugWSPort:-8052}

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
