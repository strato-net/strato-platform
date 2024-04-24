#!/usr/bin/env bash

set -e
set -x

declare -i RESULT=0

# There's a good chance that strato-getting-started is also running, so
# we change redis's port to avoid a conflict.
REDIS=$(docker run -d -p 2023:6379 redis:3.2 redis-server --appendonly yes)
trap "docker rm -f ${REDIS}" EXIT

cd strato

stack test $4\
      blockapps-data \
      blockapps-init \
      blockapps-mpdbs \
      blockapps-tools \
      blockapps-vault-proxy-server \
      bloc2api \
      common-log \
      cross-monitoring \
      debugger \
      ethereum-discovery \
      ethereum-encryption \
      ethereum-rlp \
      fast-keccak256 \
      format \
      labeled-error \
      highway/ --test-arguments="--awsaccesskeyid $1 --awssecretaccesskey $2 --awss3bucket $3" \
      merkle-patricia-db \
      seqevents \
      slipstream \
      solid-vm \
      solid-vm-model \
      solid-vm-parser \
      source-tools \
      strato-index \
      strato-lite \
      strato-genesis \
      strato-model \
      strato-redis-blockdb \
      strato-sequencer \
      vm-runner \
      x509-certs

if [ $4 = --coverage ]
then
      rm -rf hpc
      mkdir hpc
      cp -r $(stack path --local-hpc-root) .
fi
