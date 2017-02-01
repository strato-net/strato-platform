#!/bin/bash

set -e

mode=docker

usage='
  --run-tag <tag> [--bare|--reset]    Start strato from a given Docker tag.  When
                                      the containers are already running, stops
                                      and restarts them.

  --run-local [--bare|--reset]        In case you you do a local build and want to run strato locally.

    --bare                            Install necessary software for first-time run
    --reset                           On running containers, rather than
                                      stopping, does a --wipe

  --wipe                              Kill and delete all strato containers and
                                      their volumes.  This will, naturally,
                                      COMPLETELY ERASE THE BLOCKCHAIN and is a
                                      DANGEROUS last resort.

  environment variables:

  ssl             - default: false     - If true then copy certificates, i.e. pem & key files, to /etc/ssl/certs & /etc/ssl/private so that you can use strato with SSL.
  genesis         - default: stablenet - Which genesis block name prefix to use in a strato node setup; e.g. stablenetGenesis.json, livenetGenesis.json, testnetGenesis.json (see: /strato-init/src/Main.hs)
  miningAlgorithm - default: Instant   - Which block mining algorithm to use in the strato adit process; e.g. Instant or SHA (see: /strato-adit/Blockchain/Mining)
  stratoHost      - default: ""        - The hostname or ip address of the machine to which bloc should connect to to access the strato API (see: /bloc/pkg/README.md)
  networkID       - default: 6         - Network identifier used in p2p communication
  genesisBlock    - default: ""        - Provides your own genesis block; e.g. genesisBlock=$(< gb.json) (see: /silo/README.md)
  bootnode        - default: ""        - Provides the IP address of the boot-node machine in case of a v-net; e.g. bootnode=10.0.0.15 (see: silo/README.md)
  mineBlocks      - default: true      - Run strato-adit and strato-quarry processes if set to true (see: silo/monstrato/pkg/doit.sh)
  verifyBlocks    - default: false     - Indicates if mining verification will be performed (see: silo/monstrato/ethereum-vm/src/Blockchain/Verifier.hs)
  lazyBlocks      - default: true      - Indicates if lazy/empty blocks will be created (see: /monstrato/strato-quarry/lib/BlockConstruction.hs & /monstrato/ethereum-vm/src/Executable/EthereumVM.hs
  serveBlocks     - default: true      - Run strato-p2p-server if set to true (see: /monstrato/pkg/doit.sh)
  receiveBlocks   - default: true      - Run strato-p2p-client if set to true (see: /monstrato/pkg/doit.sh)
  addBootnodes    - default: false     - Get a single node connected to the public network; genesis must be set to livenet (see: /monstrato/deployments/docker/HowToDeploy.md)
  noMinPeers      - default: false     - Forces minAvailablePeers to 0 (typically set to 100; see: /monstrato/strato-init/src/Blockchain/Setup.hs)

  apiUrlOverride  - default: not specified - Overrides the strato api url in the bloc server config file; e.g. http://strato:3000 (see: /bloc/pkg/doit.sh)

'

function setEnv {
  export $1
  [[ -n ${!1} ]] || eval $1=$2
  echo "$1 = ${!1}"
}

function setEnvVars {
  setEnv ssl false

  setEnv genesis stablenet
  setEnv miningAlgorithm Instant

  setEnv stratoHost ""
  setEnv networkID 6
  setEnv genesisBlock ""
  setEnv bootnode ""
# env var for collecting backup from the node for strato and bloc containers. 
# Passed in to strato-setup via docker-compose environment vars. 
  if [[ ${backup} ]] ; then
   setEnv backupblocks true
  fi

  setEnv mineBlocks true
  setEnv verifyBlocks false
  setEnv lazyBlocks true 
  setEnv serveBlocks true
  setEnv receiveBlocks true
  setEnv addBootnodes false
  setEnv noMinPeers false
}


if [[ $# -eq 0 ]]
then
  echo >&2 "Must pass an argument.  Possible arguments are:"
  printf "%s" "$usage"
  exit 1
fi

case $1 in
  "--run-tag")
    shift
    if [[ -z $1 ]]
    then
      echo >&2 "Missing argument to --run-tag.  Usage is:"
      printf "%s" "$usage"
      exit 1
    fi
    if [ -z "$genesisBlock" ]; then
      echo "====================> Genesis Block (gb.json) is missing."
      exit 1
    fi

    doit="runTag $1"
    shift
    if [[ -z $1 ]]
    then
      doFirst="term stop"
    else
      case $1 in
        "--bare")
          doFirst="bare"
          ;;
        "--reset")
          doFirst="wipe"
          ;;
        *)
          echo >&2 "Invalid option $1 for --run-tag.  Usage is:"
          printf "%s" "$usage"
          exit 1
          ;;
      esac
      shift
    fi
    ;;
  "--run-local")
    doit="runLocal"
    doFirst=""
    ;;
  "--wipe")
    doit="wipe"
    doFirst=""
    ;;
  "--help")
    setEnvVars # To show the values
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

function runTag
{
  echo "Running strato from Docker tag $1..."
  sed "s@%REPO%\(.*\)@auth.blockapps.net:5000/blockapps/\1:$1@" \
    docker-compose.yml.template >docker-compose.yml 2>/dev/null
  docker-compose up -d
}


function runLocal
{
  echo "Running strato from local, untagged images"
  sed "s/%REPO%//" \
    docker-compose.yml.template >docker-compose.yml 2>/dev/null
  docker-compose up -d
}

function wipe
{
  term kill
  echo -n "Removing all strato containers and their volumes..."
  docker-compose down -v >&/dev/null && echo "done"
}

function term
{
  if [[ -r docker-compose.yml && -n $(docker-compose ps -q) ]]
  then 
    echo -n "Stopping all strato containers..."
    docker-compose $1 >&/dev/null && echo "done"
  fi
}

function bare
{
  (
  set -e

  if [[ $EUID -ne 0 ]]; then
    sudo=sudo
  fi

  # Controls whether to copy certs.  Must be true or false, defaults to false
  ssl=${ssl:-false}

  # Try to catch docker installation so that we don't use an unnecessary sudo.
  echo -n "Installing docker..."
  if dpkg-query -l docker-engine >&/dev/null
  then echo "already installed."
  else 
    echo
    (
    $sudo apt-key adv --keyserver hkp://p80.pool.sks-keyservers.net:80 \
      --recv-keys 58118E89F3A912897C070ADBF76221572C52609D
    echo "deb https://apt.dockerproject.org/repo ubuntu-xenial main" \
      | $sudo tee /etc/apt/sources.list.d/docker.list
    $sudo apt-get update
    $sudo apt-get -y install docker-engine
    $sudo usermod -aG docker $USER
    $sudo chown :$USER /var/run/docker.sock
    ) >&/dev/null
  fi 

  echo "Installing docker-compose..."
  # Install to /tmp first to avoid having to use sudo curl
  curl -L "https://github.com/docker/compose/releases/download/1.8.1/docker-compose-$(uname -s)-$(uname -m)" -o /tmp/docker-compose >& /dev/null
  chmod +x /tmp/docker-compose
  # cp is already in sudoers
  $sudo cp -f /tmp/docker-compose /usr/local/bin

  if $ssl; then
    echo "Copying server.pem..."
    $sudo mv server.pem /etc/ssl/certs >&/dev/null || \
      { echo "Found 'ssl=true', but couldn't find server.pem in this directory."; exit 1; }
    echo "Copying server.key..."
    $sudo mv server.key /etc/ssl/private >&/dev/null || \
      { echo "Found 'ssl=true', but couldn't find server.key in this directory."; exit 1; }
  else
    echo "The environment variable 'ssl' is unset or false.  If you wish to use
    SSL with strato, re-run the script with ssl=true."
  fi
  docker login -u blockapps -p blockAPPS123 auth.blockapps.net:5000
  )
}

setEnvVars
# Ensure backup folder exists in the node running the containers
mkdir -p /tmp/backup
$doFirst
$doit

