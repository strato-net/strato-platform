#!/bin/bash

function usage {
  cat <<EOF
Usage: $0 <blockchain name> <network size>

Launches the given number of strato "nodes" all configured to communicate on localhost. The genesis block is taken from '../strato-init/<blockchain name>Genesis.json'.
Nodes' persistent data is stored in $NODESPATH.

You must already have the postgresql server, zookeeper, and kafka all running at the standard ports.  Assumes that the kafka executables are located at $KAFKAPATH.
EOF
}

function newnode {
  i=$1
  echo "Starting node $i"

  P2PPort=$(( $BOOTSTRAP_PORT + i ))
  APIPort=$(( 3000 + i ))
  nodedir=node$i

  if [[ -e $nodedir ]]
  then rm -rf $nodedir
  fi
  mkdir $nodedir 
  pushd $nodedir >&/dev/null

  cp $startdir/../../strato-init/${GENESISNAME}Genesis.json .

  strato-setup --pguser=$PGUSER --password=$PGPASS --genesisBlockName=$GENESISNAME &&
  {
    mkdir -p logs

    echo "Starting strato processes"
    strato-index > logs/strato-index 2>&1 &
    HOST=0.0.0.0 PORT=$APIPort APPROOT="" strato-api > logs/strato-api 2>&1 & 
    strato-quarry > logs/strato-quarry 2>&1 &
    strato-adit --aMiner=SHA > logs/strato-adit 2>&1 &

    strato-p2p-server -l$P2PPort > logs/strato-p2p-server 2>&1 &
    if [[ $i -ne 0 ]]
    then echo -e "$YAML_STRING" > .ethereumH/peers.yaml
         strato-p2p-client > logs/strato-p2p-client 2>&1 & 
    fi
    ethereum-vm --qDebug --miner=SHA --createTransactionResults=true --diffPublish > logs/ethereum-vm 2>&1 &
  }

  echo
  popd >&/dev/null
}

set -e

PGUSER=postgres
PGPASS=api
BOOTSTRAP_IP=127.0.0.1
BOOTSTRAP_PORT=30303

NODESPATH=~/.strato
YAML_STRING="- - $BOOTSTRAP_IP\n  - $BOOTSTRAP_PORT"
startdir=$PWD

if [[ $# -ne 2 ]]
then usage >&2; exit 1;
fi

genesis=$1
netsize=$2

GENESISNAME=$genesis

mkdir -p $NODESPATH || { echo >&2 "$NODESPATH is not a directory!  I cannot continue."; exit 1; }
pushd $NODESPATH >&/dev/null

for i in $(seq 0 $(( $netsize - 1 )) )
do newnode $i
done
