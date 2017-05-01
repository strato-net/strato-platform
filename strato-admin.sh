#!/bin/bash

set -e

registry="registry-aws.blockapps.net:5000"
usage='

   --start                             Start containers 
   --stop                              Stop containers but dont reset data from persisted volumes on the host node
   --compose                           Generate a new docker-compose using basil compose --basilfile 

   --wipe                              Kill and delete all strato containers and
                                       their volumes.  This will, naturally,
                                       COMPLETELY ERASE THE BLOCKCHAIN and is a
                                       DANGEROUS last resort.
'

 function setEnv {
   echo "$1 = ${!1}"
   echo "Setting Env"
    echo "Creating volumes in the `pwd`"
    mkdir -p storage/strato
    mkdir -p storage/zk/data
    mkdir -p storage/zk/datalog
    mkdir -p storage/logs/kafka
    mkdir -p storage/pg-cirrus
    mkdir -p storage/kafka
    mkdir -p storage/redis
    export lazyBlocks=false
    export miningAlgorithm=SHA
    export apiUrlOverride=http://strato:3000
    export blockTime=2
    export minBlockDifficulty=8192
    export genesisBlock=$(< gb.json)
    export stratoHost=nginx
    export ssl=false
 }

function runStrato {
if grep -q "${registry}" ~/.docker/config.json
then
    echo "Creating volumes in the `pwd`"
    setEnv
    exec docker-compose up -d
else
    echo "Something went wrong! Please check the docker-compose.yml and access to the registry"
    exit 3
fi
}

function wipe {
    echo "Stopping STRATO containers and deleting volumes/data"
    docker-compose kill 
    docker-compose down
    sudo rm -rf storage
    echo "Stopped STRATO containers and deleted volumes/data"
}

echo "
    ____  __           __   ___
   / __ )/ /___  _____/ /__/   |  ____  ____  _____
  / __  / / __ \/ ___/ //_/ /| | / __ \/ __ \/ ___/
 / /_/ / / /_/ / /__/ ,< / ___ |/ /_/ / /_/ (__  )
/_____/_/\____/\___/_/|_/_/  |_/ .___/ .___/____/
                              /_/   /_/
"

if ! docker ps &> /dev/null
then
    echo 'Error: docker is required to be installed and configured for non-root users: https://www.docker.com/'
    exit 1
fi

if ! docker-compose -v &> /dev/null
then
    echo 'Error: docker-compose is required: https://docs.docker.com/compose/install/'
    exit 2
fi

case $1 in
   "--compose")
     shift
     if [[ -z $1 ]]
     then
       echo >&2 "Missing argument to --compose.  Usage is:"
       printf "%s" "$usage"
       exit 1
     fi
     if [ -z "$genesisBlock" ]; then
       echo "====================> Genesis Block (gb.json) is missing."
       exit 1
     fi
     ;;
  "--start")
     runStrato
     echo "$0 usage:"
     echo "$usage"
     exit 0
     ;;
 "--stop")
     echo "Stopping STRATO containers"
     docker-compose down
     exit 0
     ;; 
 "--wipe")
     wipe 
     exit 0
     ;; 
 "--help")
     echo "$0 usage:"
     echo "$usage"
     exit 0
     ;;
   *)
     echo >&2 "Invalid argument: $1.  Valid arguments are:"
     printf "%s" "$usage"
     exit 1
     ;;
 esac
