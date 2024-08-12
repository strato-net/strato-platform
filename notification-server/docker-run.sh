#!/bin/sh
set -e

export DOCKERIZED="true"
export PORT=8019


if [ -z "${POSTGRES_SERVER_URL}" ]; then
  echo "POSTGRES_SERVER_URL is empty but is a required value"
  exit 11
fi

if [ -z "${POSTGRES_PORT}" ]; then
  echo "POSTGRES_PORT is empty but is a required value"
  exit 12
fi

if [ -z "${POSTGRES_USER}" ]; then
  echo "POSTGRES_USER is empty but is a required value"
  exit 13
fi
  
if [ -z "${POSTGRES_PASSWORD}" ]; then
  echo "POSTGRES_PASSWORD is empty but is a required value"
  exit 14
fi

if [ -z "${POSTGRES_DBNAME}" ]; then
  echo "POSTGRES_DBNAME is empty but is a required value"
  exit 15
fi

if [ -z "${SENDGRID_API_KEY}" ]; then
  echo "SENDGRID_API_KEY is empty but is a required value"
  exit 16
fi

if [ -z "${NODE_ENV}" ]; then # default value for NODE_ENV is production
  export NODE_ENV='production'
fi

echo 'Starting notification server...'
yarn start
