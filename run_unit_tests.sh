#!/usr/bin/env bash

set -e
set -x

declare -i RESULT=0

# There's a good chance that strato-getting-started is also running, so	
# we change redis's port to avoid a conflict.	
REDIS=$(docker run -d -p 2023:6379 redis:3.2 redis-server --appendonly yes)	
trap "docker rm -f ${REDIS}" EXIT

cd strato

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
      solid-vm-model \
      solid-vm-parser \
      strato-genesis \
      strato-index \
      strato-init \
      strato-model \
      strato-p2p \
      strato-redis-blockdb \
      strato-sequencer \
      vm-runner \
      vm-tools \
      x509-certs \
      evm-solidity \
      bloc2api \
      # blockapps-vault-wrapper-server \
      blockapps-vault-proxy-server \
      slipstream \
      blockapps-privacy \
      seqevents \
      debugger \
      blockapps-init \
      common-log \
      cross-monitoring \
      format \
      labeled-error \
      source-tools \
      strato-lite

stack bench vm-runner

stack bench solid-vm

stack bench solid-vm-model
