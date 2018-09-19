#!/usr/bin/env bash

set -e
set -x

declare -i RESULT=0
TESTS=(
  blockapps-data
  blockapps-ecrecover
  blockapps-haskoin
  blockstanbul
  ethereum-discovery
  ethereum-rlp
  ethereum-vm
  merkle-patricia-db
  statsdi
  strato-genesis
  strato-init
  strato-p2p
  strato-redis-blockdb
  strato-sequencer
)

# There's a good chance that strato-getting-started is also running, so
# we change redis's port to avoid a conflict.
REDIS=$(docker run -d -p 2023:6379 redis:3.2 redis-server --appendonly yes)
trap "docker rm -f ${REDIS}" EXIT

for tst in ${TESTS[@]}; do
  time stack test $tst
done

for tst in ${TEST_AND_BENCH[@]}; do
  time stack test $tst
done
