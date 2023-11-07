#!/usr/bin/env sh
SITE_ID=${SITE_ID:-}
sed -i "s|__SITE_ID__|$SITE_ID|g" build/index.html
# Creating .env file if using the relevant flags
if [ -n "${ASSET_TABLE_NAME}" ] || [ -n "${SALE_TABLE_NAME}" ] || [ -n "${REACT_APP_SITE_ID}" ]; then
  if [ ! -f .env ]; then
    # If it doesn't exist, create the .env file and insert environment variables.
    touch .env

    echo "REACT_APP_ASSET_TABLE_NAME=${ASSET_TABLE_NAME}" >> .env
    echo "REACT_APP_SALE_TABLE_NAME=${SALE_TABLE_NAME}" >> .env
    echo "REACT_APP_SITE_ID=${REACT_APP_SITE_ID}" >> .env
  else
    # If the .env file exists, replace the environment variables.
    sed -i `s/REACT_APP_ASSET_TABLE_NAME=.*/REACT_APP_ASSET_TABLE_NAME=${ASSET_TABLE_NAME}/` .env
    sed -i `s/REACT_APP_SALE_TABLE_NAME=.*/REACT_APP_SALE_TABLE_NAME=${SALE_TABLE_NAME}/` .env
    sed -i `s/REACT_APP_SITE_ID=.*/REACT_APP_SITE_ID=${REACT_APP_SITE_ID}/` .env
  fi
fi

echo 'Starting ui server...'

npx react-inject-env set && serve --single -l 3003 build
