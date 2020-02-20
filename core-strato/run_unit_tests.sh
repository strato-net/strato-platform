#!/usr/bin/env bash

set -e
set -x

declare -i RESULT=0
TESTS=(
  blockapps-data
  blockapps-ecrecover
  blockapps-mpdbs
  blockapps-tools
  blockstanbul
  ethereum-discovery
  ethereum-rlp
  ethereum-vm
  fast-keccak256
  merkle-patricia-db
  solid-vm
  strato-api:unittests
  strato-genesis
  strato-init
  strato-model
  strato-p2p
  strato-redis-blockdb
  strato-sequencer
  vm-runner
  vm-tools
)

BENCHES=(
  vm-runner
)

for tst in ${TESTS[@]}; do
  time stack test $tst
done

for tst in ${BENCHES[@]}; do
  time stack bench $tst
done
