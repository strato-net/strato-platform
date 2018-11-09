#!/bin/bash

set -e
set -x

PROCESS_MONITORING=${PROCESS_MONITORING:-true}
declare -A MONITORED_PIDS
MONITORING_TIMER=5;

function newnode {
  initialize=false

  mkdir -p logs/rotation

  if [[ ! -d .ethereumH ]]
  then initialize=true
       cleanupDB
       doInit
  fi

  echo "Starting Strato processes. All output is logged to $PWD/logs."

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
  runBackgroundProcess ethereum-discover &>> logs/ethereum-discover

  actualTimeout="${connectionTimeout:-300}"
  if [ -n "${blockstanbulRoundPeriodS}" ]; then
    withCushion=$(( 2 * blockstanbulRoundPeriodS ))
    actualTimeout=$(( actualTimeout > withCushion ? actualTimeout : withCushion ))
  fi
  if [ -n "${validators}" ]; then
    numValidators=$(( 1 + $( echo "${validators}" | tr -cd , | wc -c) ))
    maxConn=$(( maxConn >= numValidators ? maxConn : numValidators ))
  fi
  if [[ -n "${blockstanbul}" || -n "${txGossipFanout}" ]]; then
    txgFlag="--txGossipFanout=${txGossipFanout:-3}"
  fi

  echo "Starting strato-p2p"
  runBackgroundProcess strato-p2p \
     --connectionTimeout=$actualTimeout \
     --sqlPeers=true \
     --debugFail=${debugFail:-true}  \
     --maxConn=$maxConn \
     --maxReturnedHeaders=$maxReturnedHeaders \
     --networkID=$networkID \
     ${txgFlag} \
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
  NODEKEY=${blockstanbulPrivateKey:-} runBackgroundProcess strato-sequencer \
    "${bpFlag}" "${rpFlag}" "${vsFlag}" "${tbFlag}" "${evsFlag}" "${usFlag}" \
    --minLogLevel=$seqMinLogLevel &>> logs/strato-sequencer

  echo "Starting strato-api-indexer"
  runBackgroundProcess strato-api-indexer +RTS -N1 >> logs/strato-api-indexer 2>&1

  echo "Starting strato-p2p-indexer"
  runBackgroundProcess strato-p2p-indexer +RTS -N1 >> logs/strato-p2p-indexer 2>&1

  echo "Starting strato-txr-indexer"
  runBackgroundProcess strato-txr-indexer +RTS -N1 >> logs/strato-txr-indexer 2>&1


  echo "Starting ethereum-vm"
  runBackgroundProcess ethereum-vm --useSyncMode=$useSyncMode --miner=$miningAlgorithm --maxTxsPerBlock=$maxTxsPerBlock \
                         --diffPublish=$diffPublish --sqlDiff=$sqlDiff --createTransactionResults=true \
                         --miningVerification=$verifyBlocks --difficultyBomb=$difficultyBomb \
                         --trace=$evmTraceMode --debug=$evmDebugMode --minLogLevel=$evmMinLogLevel \
                         "${tbFlag}" +RTS -N1 >> logs/ethereum-vm 2>&1

  echo "Starting strato-api"
  HOST=0.0.0.0 PORT=3000 APPROOT="" FETCH_LIMIT=2000 runBackgroundProcess strato-api +RTS -N1 >> logs/strato-api 2>&1

  echo "Configuring log maintenance"
  runBackgroundProcess cleanupLogs

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
  export blockTime=${blockTime:-13}
  export minBlockDifficulty=${minBlockDifficulty:-131072}
  if [[ -n "${extraFaucets}" || -n "${validators}" ]]; then
    xfFlag="--extraFaucets=${extraFaucets:-$validators}"
  fi
  cmd="strato-setup --pguser=$pgUser --password=$pgPass --genesisBlockName=$genesis --kafka=./kafka-topics.sh \
                    --pghost=$pgHost --kafkahost=$kafkaHost --zkhost=$zkHost --lazyblocks=$lazyBlocks \
                    --redisHost=$redisBDBHost --redisPort=$redisBDBPort --redisDBNumber=$redisBDBNumber \
                    --addBootnodes=$addBootnodes $stratoBootnode \
                    --blockTime=$blockTime --minBlockDifficulty=$minBlockDifficulty $xfFlag"
# For backup_restore; the environment var is set during strato-admin.sh invocation.
# Required: Backup file to be accessible to strato container at /tmp/backup
  if [[ $backupblocks ]] ; then
     cmd="${cmd} --backupblocks=true < /var/lib/strato/backup_strato_block"
     echo "# of lines in block-backup-file: " `cat $backupLocation | wc -l`
  fi

  echo "strato-setup command: $cmd"
  # logging to stdout and log file:
  $cmd 2>&1 | tee logs/strato-setup
  if [ ${PIPESTATUS[0]} -ne 0 ]; then
    echo "STRATO SETUP FAILED: see /var/lib/strato/logs/strato-setup for details"
    tail -f /dev/null
  fi

  sed -i 's/minAvailablePeers:.*/minAvailablePeers: '"$numMinPeers"'/' .ethereumH/ethconf.yaml

  echo "Creating a random coinbase"
  mkCoinbase
}

# Find all logs greater than 10M, then copy and truncate
function cleanupLogs {
  while true
  do
    sleep 900 ;
    find $PWD/logs/ -maxdepth 1 -type f -size +10M -exec /bin/cp -rf {} $PWD/logs/rotation/ \; -exec truncate -s 0 {} \;
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

setEnv networkID 6
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

setEnv sqlDiff true
setEnv diffPublish true

setEnv backupLocation /var/lib/strato/backup_strato_block

setEnv evmDebugMode false
setEnv evmTraceMode false

stratoBootnode=${bootnode:+--stratoBootnode=$bootnode}
[[ -n $bootnode ]] && addBootnodes=true

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
