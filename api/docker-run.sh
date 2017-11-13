#!/usr/bin/env bash
set -e
set -x

echo 'Waiting for postgres to be available'
while true; do
    curl postgres:5432 > /dev/null 2>&1
    if [ $? = 52 ]; then
        break
    fi
    sleep 1
done

echo 'Waiting for postgres-cirrus to be available'
while true; do
    curl postgres-cirrus:5432 > /dev/null 2>&1
    if [ $? = 52 ]; then
        break
    fi
    sleep 1
done


STRATO_LOCAL_HOST=${STRATO_LOCAL_HOST:-nginx}

sed -i 's/__STRATO_LOCAL_HOST__/'"${STRATO_LOCAL_HOST}"'/g' config-prod.yaml

STRATO_LOCAL_HOST=${STRATO_LOCAL_HOST} NODE_HOST=${NODE_HOST} npm run start:prod
