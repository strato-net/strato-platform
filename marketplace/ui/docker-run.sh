#!/usr/bin/env sh
SITE_ID=${SITE_ID:-}

export STRATO_HOSTNAME=${STRATO_HOSTNAME:-strato}
export STRATO_PORT_API=${STRATO_PORT_API:-3000}
export ETH_ENDPOINT=http://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2
echo 'Waiting for Strato api to be available...'
until curl --silent --output /dev/null --fail --location ${ETH_ENDPOINT}/stats/totaltx
do
  echo "  Check at $(date)"
  sleep 1
done
echo 'Strato api is available'

FILE_SERVER_URL=$(curl --silent --fail ${ETH_ENDPOINT}/metadata | jq -r .urls.fileServer)
if [ -z "${FILE_SERVER_URL}" ]; then
  echo "Could not get file server url from strato api, but it is a required value"
  exit 1
fi

sed -i "s|__SITE_ID__|$SITE_ID|g" build/index.html
sed -i "s|__FILE_SERVER_URL__|$FILE_SERVER_URL|g" build/index.html

echo 'Starting ui server...'

serve --single -l 3003 build
