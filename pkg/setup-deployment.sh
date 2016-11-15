#!/bin/bash

set -e

echo "Hello postgrest-packager:setup-deployment.sh"

POSTGREST_VERSION=0.3.2.0
POSTGREST_SCHEMA=public
POSTGREST_ANONYMOUS=postgres
POSTGREST_JWT_SECRET=thisisnotarealsecret
POSTGREST_MAX_ROWS=1000000
POSTGREST_POOL=200

$sudo apt-get update && \
    $sudo apt-get install -y tar xz-utils wget libpq-dev && \
    $sudo apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

wget http://github.com/begriffs/postgrest/releases/download/v${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-ubuntu.tar.xz && \
    tar --xz -xvf postgrest-${POSTGREST_VERSION}-ubuntu.tar.xz && \
    $sudo mv postgrest /usr/local/bin/postgrest && \
    rm postgrest-${POSTGREST_VERSION}-ubuntu.tar.xz

$sud apt-get update && apt-get install -y wget
wget https://github.com/jwilder/dockerize/releases/download/v0.1.0/dockerize-linux-amd64-v0.1.0.tar.gz
$sudo tar -C /usr/local/bin -xzvf dockerize-linux-amd64-v0.1.0.tar.gz

