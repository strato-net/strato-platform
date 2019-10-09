#!/usr/bin/env bash
set -o
set -e

if [[ -z $blocHost || -z $stratoHost || -z $vaultWrapperHost || -z $postgrestHost || -z $prometheusHost || -z $EXT_STORAGE_S3_BUCKET || -z $EXT_STORAGE_S3_ACCESS_KEY_ID || -z $EXT_STORAGE_S3_SECRET_ACCESS_KEY ]]; then
  echo "ERROR: One of the required variables is not set or empty. See README.md for details.
Vars required to run tests: 
- blocHost, 
- postgrestHost,
- prometheusHost,
- stratoHost,
- vaultWrapperHost,
- EXT_STORAGE_S3_BUCKET,
- EXT_STORAGE_S3_ACCESS_KEY_ID,
- EXT_STORAGE_S3_SECRET_ACCESS_KEY"
  exit 1
fi
  
source set-aux-env-vars.sh

# Prepare testdata
cd test/testdata
rm -rf testdata.zip addresses.js
zip -r testdata.zip .
cd -

if [[ ! "$NODE_ENV" = development  && ! "$NODE_ENV" = test ]]; then
  echo "NODE_ENV should be either 'development' or 'test' to run the tests. It is ${NODE_ENV:-unset} instead."
fi

# Create and migrate db for the corresponding NODE_ENV (test/development):
npm run db-create
npm run db-migrate

# When running tests on the host (for development)
if [ "$NODE_ENV" == development ]; then
  postgres_port=${postgres_port:-15433}
  config_dev_postgres_port=$(node -e 'console.log(require("./config/config.json")["development"]["port"])')
  if [ ! "$postgres_port" = "$config_dev_postgres_port" ]; then 
    echo "ERROR: postgres_port is altered and does not match with config/config.json ->development->port value"
    exit 2
  fi
  ./node_modules/mocha/bin/mocha $NODE_DEBUG_OPTION --config=config-local.yaml test/
fi

# When running tests inside the apex container
if [ "$NODE_ENV" == test ]; then
  ./node_modules/mocha/bin/mocha $NODE_DEBUG_OPTION --config=config-prod.yaml test/
fi
