#!/usr/bin/env bash

set -e
set -x

declare -i RESULT=0

# There's a good chance that strato-getting-started is also running, so
# we change redis's port to avoid a conflict.
REDIS=$(docker run -d -p 2023:6379 redis:3.2 redis-server --appendonly yes)
trap "docker rm -f ${REDIS}" EXIT

cd strato

stack test $1\
      blockapps-data \
      blockapps-init \
      blockapps-mpdbs \
      blockapps-tools \
      blockapps-vault-proxy-server \
      blockstanbul \
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
      merkle-patricia-db \
      seqevents \
      slipstream \
      solid-vm \
      solid-vm-model \
      solid-vm-parser \
      source-tools \
      strato-index \
      strato-init \
      strato-lite \
      strato-genesis \
      strato-model \
      strato-p2p \
      strato-redis-blockdb \
      strato-sequencer \
      vm-runner \
      vm-tools \
      x509-certs

if [ $1 = --coverage ]
then
      rm -rf hpc
      mkdir hpc
      cp -r $(stack path --local-hpc-root) hpc/
fi
