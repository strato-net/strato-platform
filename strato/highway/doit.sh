#!/bin/bash

set -ex

minLogLevel=LevelInfo
if [ "${VAULTWRAPPER_DEBUG:-false}" == true ]; then
  minLogLevel=LevelDebug
fi

echo 'Starting up Highway...'

RED='\033[0;31m'
NC='\033[0m' # No Color

blockapps-highway-wrapper-server \
  || set +x && echo -e "\n${RED}blockapps-highway-wrapper-server has terminated!!!${NC}" && tail -f /dev/null
