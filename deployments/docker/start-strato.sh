#!/bin/bash

. set-params.sh

if [[ $# -gt 0 ]]
then 
   networkId=${1:-${networkId:-1}}
fi
export networkId 

genesisFile=${mode}Genesis.json
if [[ -f $genesisFile ]]
then
  export genesisBlock=$(<$genesisFile)
fi

echo $mode >mode

echo
echo "You have to add the line"
echo
echo -e "\t127.0.0.1 kafka"
echo
echo "to /etc/hosts in order to connect to kafka locally"
echo

docker-compose up -d nginx

