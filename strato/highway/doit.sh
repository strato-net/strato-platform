#!/bin/bash

echo "Environment variables:
highway-wrapper:
--awsaccesskeyid=\$awsaccesskeyid
--awssecretaccesskey=\$awssecretaccesskey
--awss3bucket=\$awss3bucket
"

echo 'Starting up Highway...'

RED='\033[0;31m'
NC='\033[0m' # No Color

blockapps-highway-wrapper-server \
  --awsaccesskeyid="$awsaccesskeyid" --awssecretaccesskey="$awssecretaccesskey" --awss3bucket="$awss3bucket" --minLogLevel="${minLogLevel}" \
  || set +x && echo -e "\n${RED}blockapps-highway-wrapper-server has terminated!!!${NC}" && tail -f /dev/null
