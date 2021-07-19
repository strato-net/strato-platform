#!/usr/bin/env bash

set -e

declare -i RESULT=0

# There's a good chance that strato-getting-started is also running, so	
# we change redis's port to avoid a conflict.	
REDIS=$(docker run -d -p 2023:6379 redis:3.2 redis-server --appendonly yes)	
trap "docker rm -f ${REDIS}" EXIT

stack test -j1 \
      blockapps-data \
      blockapps-mpdbs \
      blockapps-tools \
      blockstanbul \
      ethereum-discovery \
      ethereum-encryption \
      ethereum-rlp \
      ethereum-vm \
      fast-keccak256 \
      merkle-patricia-db \
      solid-vm \
      strato-genesis \
      strato-init \
      strato-model \
      strato-p2p \
      strato-redis-blockdb \
      strato-sequencer \
      vm-runner \
      vm-tools \
      x509-certs \
      blockapps-ethereum \
      blockapps-solidity \
      blockapps-strato-api \
      blockapps-bloc22-server \
      blockapps-bloc22-api \
      blockapps-vault-wrapper-server \
      slipstream \
      blockapps-privacy \
      seqevents \
      debugger \
      ./shared-util/

stack bench vm-runner
