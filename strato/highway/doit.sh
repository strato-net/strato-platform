#!/bin/bash

if [[ -n $HIGHWAY_URL ]]; then
  if [[ $HIGHWAY_URL != http* ]]; then
    echo "HIGHWAY_URL must start with protocol (http:// or https://)"
    exit 1
  fi
  HIGHWAY_URL_FLAG="--highwayUrl=${HIGHWAY_URL}"
fi

echo "Environment variables:
highway:
${HIGHWAY_URL_FLAG:-}
--awsaccesskeyid=$EXT_STORAGE_S3_ACCESS_KEY_ID
--awssecretaccesskey=$EXT_STORAGE_S3_SECRET_ACCESS_KEY
--awss3bucket=$EXT_STORAGE_S3_BUCKET
"

echo 'Starting up Highway...'

RED='\033[0;31m'
NC='\033[0m' # No Color

blockapps-highway-server \
  ${HIGHWAY_URL_FLAG:-} \
  --awsaccesskeyid="$EXT_STORAGE_S3_ACCESS_KEY_ID" \
  --awssecretaccesskey="$EXT_STORAGE_S3_SECRET_ACCESS_KEY" \
  --awss3bucket="$EXT_STORAGE_S3_BUCKET" \
  --minLogLevel="${minLogLevel:-LevelInfo}" \
  || set +x && echo -e "\n${RED}blockapps-highway-server has terminated!!!${NC}" && tail -f /dev/null
