#!/usr/bin/env sh
SITE_ID=${SITE_ID:-}
sed -i "s|__SITE_ID__|$SITE_ID|g" build/index.html

# Creating or updating .env file if using the relevant flags
if [ -n "${ASSET_TABLE_NAME}" ] || [ -n "${SALE_TABLE_NAME}" ] || [ -n "${REACT_APP_FILE_SERVER_URL}" ]; then
  if [ ! -f .env ]; then
    # If .env doesn't exist, create the .env file and insert environment variables
    touch .env

    echo "REACT_APP_ASSET_TABLE_NAME=${ASSET_TABLE_NAME}" >> .env
    echo "REACT_APP_SALE_TABLE_NAME=${SALE_TABLE_NAME}" >> .env
    echo "REACT_APP_FILE_SERVER_URL=${REACT_APP_FILE_SERVER_URL}" >> .env
  else
    # If the .env file exists, replace the environment variables
    sed -i `s/REACT_APP_ASSET_TABLE_NAME=.*/REACT_APP_ASSET_TABLE_NAME=${ASSET_TABLE_NAME}/` .env
    sed -i `s/REACT_APP_SALE_TABLE_NAME=.*/REACT_APP_SALE_TABLE_NAME=${SALE_TABLE_NAME}/` .env
    sed -i `s/REACT_APP_FILE_SERVER_URL=.*/REACT_APP_FILE_SERVER_URL=${REACT_APP_FILE_SERVER_URL}/` .env
  fi
fi

echo 'Starting ui server...'

serve --single -l 3003 build
