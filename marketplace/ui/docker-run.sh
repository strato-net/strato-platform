#!/usr/bin/env sh
SITE_ID=${SITE_ID:-}

export STRATO_NODE_PROTOCOL=${STRATO_NODE_PROTOCOL:-http}
export STRATO_HOSTNAME=${STRATO_HOSTNAME:-strato}
export STRATO_PORT_API=${STRATO_PORT_API:-3000}
export ETH_ENDPOINT=${STRATO_NODE_PROTOCOL}://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2
echo 'Waiting for Strato api to be available...'
until curl --silent --output /dev/null --fail --location ${ETH_ENDPOINT}/uuid
do
  echo "  Check at $(date)"
  sleep 1
done
echo 'Strato api is available'

export networkID=$(curl --silent --fail ${ETH_ENDPOINT}/metadata | jq -r .networkID)
export FILE_SERVER_URL=${FILE_SERVER_URL}

sed -i "s|__SITE_ID__|$SITE_ID|g" build/index.html
sed -i "s|__networkID__|$networkID|g" build/index.html
sed -i "s|__FILE_SERVER_URL__|$FILE_SERVER_URL|g" build/index.html
if [ ! -f .env ]; then
  # If it doesn't exist, create the .env file and insert environment variables.
  touch .env

  echo "REACT_APP_ASSET_TABLE_NAME=${ASSET_TABLE_NAME}" >> .env
  echo "REACT_APP_SALE_TABLE_NAME=${SALE_TABLE_NAME}" >> .env
else
  # If the .env file exists, replace the environment variables.
  sed -i `s/REACT_APP_ASSET_TABLE_NAME=.*/REACT_APP_ASSET_TABLE_NAME=${ASSET_TABLE_NAME}/` .env
  sed -i `s/REACT_APP_SALE_TABLE_NAME=.*/REACT_APP_SALE_TABLE_NAME=${SALE_TABLE_NAME}/` .env
fi

echo 'Starting ui server...'

serve --single -l 3003 build
