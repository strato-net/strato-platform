#!/usr/bin/env bash
set -e
set -x

#sleep 3 # TODO: sleep until 'curl postgres:5432' exit code = 52

STRATO_LOCAL_HOST=${STRATO_LOCAL_HOST:-nginx}

sed -i 's/__STRATO_LOCAL_HOST__/'"${STRATO_LOCAL_HOST}"'/g' config-prod.yaml

STRATO_LOCAL_HOST=${STRATO_LOCAL_HOST} NODE_HOST=${NODE_HOST} npm run start:prod
