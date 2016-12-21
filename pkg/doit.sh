#!/bin/bash

set -e

function newnode {
  initialize=false
  if [[ ! -d .ethereumH ]]
  then initialize=true
       doInit
  fi

  mkdir -p logs
  echo "Starting Strato processes. All output is logged to $PWD/logs."

  if $mineBlocks
  then echo "Starting strato-adit"
      export miningThreads=${miningThreads:-1}
      runForever strato-adit --threads=${miningThreads:-1} --aMiner=$miningAlgorithm >> logs/strato-adit 2>&1
  fi

  if $serveBlocks
  then echo "Starting strato-p2p-server"
       runForever strato-p2p-server --networkID=$networkID >> logs/strato-p2p-server 2>&1
  fi

  if $receiveBlocks
  then echo "Starting strato-p2p-client"
       runForever strato-p2p-client --cNetworkID=$networkID --sqlPeers=true >> logs/strato-p2p-client 2>&1
  fi

  echo "Starting strato-sequencer"
  runForever strato-sequencer >> logs/strato-sequencer 2>&1

  echo "Starting strato-index"
  runForever strato-index >> logs/strato-index 2>&1

  echo "Starting ethereum-vm"
  runForever ethereum-vm --miner=$miningAlgorithm --diffPublish=true --createTransactionResults=true --miningVerification=$verifyBlocks >> logs/ethereum-vm 2>&1

  if $initialize
  then doRegister
  fi

  echo "Becoming strato-api"
  HOST=0.0.0.0 PORT=3000 APPROOT="" FETCH_LIMIT=2000 exec strato-api 2>&1 | tee -a logs/strato-api
}

function doInit {
  export blockTime=${blockTime:-13}
  export minBlockDifficulty=${minBlockDifficulty:-131072}
  cmd="strato-setup --pguser=$pgUser --password=$pgPass --genesisBlockName=$genesis --kafka=./kafka-topics.sh \
                    --pghost=$pgHost --kafkahost=$kafkaHost --zkhost=$zkHost --lazyblocks=$lazyBlocks \
                    --addBootnodes=$addBootnodes $stratoBootnode \
                    --blockTime=$blockTime --minBlockDifficulty=$minBlockDifficulty"
  echo $cmd
  $cmd

  if $noMinPeers
  then sed -i 's/minAvailablePeers:.*/minAvailablePeers: 0/' .ethereumH/ethconf.yaml
  fi

  cp node_modules/blockapps-js/dist/blockapps{,-min}.js static/js

  echo "Creating a random coinbase"
  ./mkCoinbase
}

function doRegister {
  echo "Registering with the blockchain explorer"
  fqdn=${stratoHost:-$(curl ident.me)}
  until [[ $(curl -s -d "url=http://$fqdn/" http://$explorerHost:9000/api/nodes) == "SUCCESS" ]] ; do : ; done
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

trap rmEthereumH EXIT

function setEnv {
  [[ -n ${!1} ]] || eval $1=$2
  echo "$1 = ${!1}"
}

echo "Environment variables:"

setEnv pgUser postgres
setEnv pgPass api
setEnv pgHost postgres

setEnv kafkaHost kafka
setEnv zkHost zookeeper

setEnv explorerHost explorer

setEnv genesis stablenet
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
setEnv noMinPeers false

stratoBootnode=${bootnode:+--stratoBootnode=$bootnode}
[[ -n $bootnode ]] && addBootnodes=true

cd /var/lib/strato

if [[ -n $genesisBlock ]]
then echo "$genesisBlock" > ${genesis}Genesis.json
fi

until nc -z zookeeper 2181 >&/dev/null
do  echo "Waiting for Kafka to become available"
    sleep 1
done

global-db --pghost postgres || { echo "Ignoring."; true; } # If it fails, it just means we already created the global db
newnode
