#!/bin/bash

#cd /usr/bin/bloc/
function setEnv {
  [[ -n ${!1} ]] || eval $1=$2
  echo "$1 = ${!1}"
}
echo "Environment variables:"

setEnv pguser postgres
setEnv pgpasswd api
setEnv pghost postgres
setEnv stratourl http://localhost 
setEnv cirrusurl http://localhost/cirrus 

blocserver="/usr/bin/blockapps-bloc"
locale-gen "en_US.UTF-8"
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8
echo "Executing this: $blocserver --pghost="$pghost" --pguser="$pguser" --password="$pgpasswd" --stratourl="$stratourl/strato-api/eth/v1.2" --cirrusurl="$cirrusurl""
$blocserver --pghost="$pghost" --pguser="$pguser" --password="$pgpasswd" --stratourl="$stratourl/strato-api/eth/v1.2" --cirrusurl="$cirrusurl" 2>&1
