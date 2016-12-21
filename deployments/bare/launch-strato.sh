#!/bin/bash

PGUSER=postgres
PGPASS=api
BOOTSTRAP_IP=strato-dev3.blockapps.net
BOOTSTRAP_PORT=30303
GENESISNAME="strato-dev"

YAML_STRING=$(printf "%s %s %s\n %s %s" "-" "-" "$BOOTSTRAP_IP" "-" "$BOOTSTRAP_PORT")

strato-setup --pguser=$PGUSER --password=$PGPASS --genesisBlockName=$GENESISNAME &&
{
  echo $YAML_STRING > .ethereumH/peers.yaml

  mkdir -p logs

  echo "Starting strato processes"
  strato-index > logs/strato-index 2>&1 &
  strato-api > logs/strato-api 2>&1 & 
  strato-quarry > logs/strato-quarry 2>&1 &
  strato-adit --miner=SHA > logs/strato-adit 2>&1 &
  strato-p2p-server > logs/strato-p2p-server 2>&1 &
  strato-p2p-client > logs/strato-p2p-client 2>&1 & 
  ethereum-vm --miner=SHA --createTransactionResults=true --transactionRootVerification=false > logs/ethereum-vm 2>&1 &
}
