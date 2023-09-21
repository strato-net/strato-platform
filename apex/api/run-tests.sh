#!/usr/bin/env sh
set -o
set -e

if [[ -z $PROMETHEUS_HOST || -z $STRATO_HOSTNAME || -z $STRATO_PORT_API || -z $STRATO_PORT_VAULT_PROXY ]]; then
  echo "ERROR: One of the required variables is not set or empty. See README.md for details.
Vars required to run tests:
- PROMETHEUS_HOST,
- STRATO_HOST
- STRATO_PORT_API
- STRATO_PORT_VAULT_PROXY
"
  exit 1
fi

source set-aux-env-vars.sh

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
  ./node_modules/mocha/bin/mocha $NODE_DEBUG_OPTION test/
fi

# When running tests inside the apex container
if [ "$NODE_ENV" == test ]; then
  ./node_modules/mocha/bin/mocha $NODE_DEBUG_OPTION test/
fi
