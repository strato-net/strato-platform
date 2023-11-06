#!/bin/bash

set -ex

minLogLevel=LevelInfo
if [ "${VAULTWRAPPER_DEBUG:-false}" == true ]; then
  minLogLevel=LevelDebug
fi

echo "Environment variables:
highway-wrapper:
--awsaccesskeyid=\$awsaccesskeyid="AKIAV5NMROVZIZQY4OAE"
--awssecretaccesskey=\$awssecretaccesskey="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"
--awss3bucket=\$awss3bucket="mercata-testnet2"
--minLogLevel="${minLogLevel}"
"

echo 'Starting up Highway...'

RED='\033[0;31m'
NC='\033[0m' # No Color

blockapps-highway-wrapper-server \
  --awsaccesskeyid="$awsaccesskeyid" --awssecretaccesskey="$awssecretaccesskey" --awss3bucket="$awss3bucket" --minLogLevel="${minLogLevel}" \
  || set +x && echo -e "\n${RED}blockapps-highway-wrapper-server has terminated!!!${NC}" && tail -f /dev/null
