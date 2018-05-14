#!/bin/bash

set -e
set -x

function newnode {
  initialize=false
  if [[ ! -d .ethereumH ]]
  then initialize=true
    doInit
  fi

  mkdir -p logs/rotation
  echo "Starting Strato processes. All output is logged to $PWD/logs."

  echo "Starting strato-api-indexer"
  runForever strato-api-indexer >> logs/strato-api-indexer 2>&1

  echo "Starting strato-p2p-indexer"
  runForever strato-p2p-indexer >> logs/strato-p2p-indexer 2>&1

  minLogLevel=LevelInfo
  if [ "${evmDebugMode}" = true ] ; then
      minLogLevel=LevelDebug
  fi

  echo "Configuring log maintenance"
  runForever cleanupLogs

  echo "Starting strato-txr-indexer"
  echo "Check logs in /var/lib/strato/logs of the container..."
  strato-txr-indexer 2>&1 | tee -a logs/strato-txr-indexer
}

function doInit {
  cp -r /var/lib/node_modules /var/lib/strato/.
  cp  /var/lib/mkCoinbase  /var/lib/strato/.
  export blockTime=${blockTime:-13}
  export minBlockDifficulty=${minBlockDifficulty:-131072}
  cmd="strato-setup --pguser=$pgUser --password=$pgPass --genesisBlockName=$genesis --kafka=./kafka-topics.sh \
                    --pghost=$pgHost --kafkahost=$kafkaHost --zkhost=$zkHost --lazyblocks=$lazyBlocks \
                    --redisHost=$redisBDBHost --redisPort=$redisBDBPort --redisDBNumber=$redisBDBNumber \
                    --addBootnodes=$addBootnodes $stratoBootnode \
                    --blockTime=$blockTime --minBlockDifficulty=$minBlockDifficulty \
                    --statsEnable=$statsEnable --statsHost=$statsHost --statsPort=$statsPort \
                    --statsFlush=$statsFlush --statsPrefix='$statsPrefix' --statsSuffix='$statsSuffix'"
# For backup_restore; the environment var is set during strato-admin.sh invocation.
# Required: Backup file to be accessible to strato container at /tmp/backup
  if [[ $backupblocks ]] ; then
     cmd="${cmd} --backupblocks=true < /var/lib/strato/backup_strato_block"
     echo "# of lines in block-backup-file: " `cat $backupLocation | wc -l`
  fi

  echo $cmd
  $cmd

  sed -i 's/minAvailablePeers:.*/minAvailablePeers: '"$numMinPeers"'/' .ethereumH/ethconf.yaml

  cp node_modules/blockapps-js/dist/blockapps{,-min}.js static/js

  echo "Creating a random coinbase"
  ./mkCoinbase
}

# Find all logs greater than 10M, then copy and truncate
function cleanupLogs {
  while true
  do
    sleep 900 ;
    find $PWD/logs/ -maxdepth 1 -type f -size +10M -exec /bin/cp -rf {} $PWD/logs/rotation/ \; -exec truncate -s 0 {} \;
  done
}

function runForever {
  while :
  do  $@
      sleep 1
  done &
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

setEnv networkID 6
setEnv genesisBlock ""
setEnv bootnode ""

setEnv mineBlocks true
setEnv verifyBlocks false
setEnv instantMining true
setEnv lazyBlocks true
setEnv serveBlocks true
setEnv receiveBlocks true
setEnv addBootnodes false
setEnv numMinPeers 0
setEnv useSyncMode false
setEnv minQuorumSize 1
setEnv maxConn 20
setEnv difficultyBomb false

setEnv sqlDiff true
setEnv diffPublish true

setEnv backupLocation /var/lib/strato/backup_strato_block

setEnv statsEnable false
setEnv statsHost telegraf
setEnv statsPort 8125
setEnv statsFlush 1000
setEnv statsPrefix ""
setEnv statsSuffix ""

setEnv evmDebugMode false
setEnv evmTraceMode false

stratoBootnode=${bootnode:+--stratoBootnode=$bootnode}
[[ -n $bootnode ]] && addBootnodes=true

#if [[ ! -d .ethereumH ]]
#then
# Override kafka hostname to workaround the behavior when kafka only accepts connection for the hostname it is initially running on
if [ -z ${kafkaIP} ]
then
  echo "kafkaIP is unset - using hostname from kafkaHost var to connect to kafka"
else
  echo "${kafkaIP} ${kafkaHost}" >> /etc/hosts
fi
#fi

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

until [ -d ".ethereumH" ]
do
  echo "Waiting for .ethereumH directory to be copied"
  sleep 1
done

newnode
