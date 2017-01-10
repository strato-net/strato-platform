#!/bin/bash

set -e

# Will also include "local" one day
mode=docker

usage='
  --run-tag <tag> [--bare|--reset]    Start strato from a given Docker tag.  When
                                      the containers are already running, stops
                                      and restarts them.
    --bare                            Install necessary software for first-time run
    --reset                           On running containers, rather than
                                      stopping, does a --wipe
  --wipe                              Kill and delete all strato containers and 
                                      their volumes.  This will, naturally,
                                      COMPLETELY ERASE THE BLOCKCHAIN and is a
                                      DANGEROUS last resort.
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

