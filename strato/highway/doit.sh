#!/bin/bash

echo "Environment variables:
highway-wrapper:
--awsaccesskeyid=$EXT_STORAGE_S3_ACCESS_KEY_ID
--awssecretaccesskey=$EXT_STORAGE_S3_SECRET_ACCESS_KEY
--awss3bucket=$EXT_STORAGE_S3_BUCKET
"

echo 'Starting up Highway...'

RED='\033[0;31m'
NC='\033[0m' # No Color

blockapps-highway-wrapper-server \
  --awsaccesskeyid="$EXT_STORAGE_S3_ACCESS_KEY_ID" \
  --awssecretaccesskey="$EXT_STORAGE_S3_SECRET_ACCESS_KEY" \
  --awss3bucket="$EXT_STORAGE_S3_BUCKET" \
  --minLogLevel="${minLogLevel:-LevelInfo}" \
  || set +x && echo -e "\n${RED}blockapps-highway-wrapper-server has terminated!!!${NC}" && tail -f /dev/null
