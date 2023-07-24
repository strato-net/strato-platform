#!/bin/bash -le
set -x
echo "Running ba-rest E2E tests"
cd blockapps-rest
DOCKER_HOST=172.17.0.1
docker build -f Dockerfile.test --build-arg host=${DOCKER_HOST} --no-cache

