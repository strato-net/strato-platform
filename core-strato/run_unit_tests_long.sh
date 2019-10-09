#!/usr/bin/env bash

set -e
set -x

declare -i RESULT=0
TESTS=(
  blockapps-data
  blockapps-ecrecover
  ethereum-discovery
  ethereum-vm
  merkle-patricia-db
  strato-api:unittests
  strato-genesis
  strato-init
  strato-p2p
  strato-redis-blockdb
)

TEST_AND_BENCH=(
  blockapps-haskoin
  blockstanbul
  ethereum-rlp
  strato-sequencer
)

# There's a good chance that strato-getting-started is also running, so
# we change redis's port to avoid a conflict.
POSTGRES=$(docker run -d -p 2345:5432 postgres:9.6)
trap "docker rm -f ${POSTGRES}" EXIT
REDIS=$(docker run -d -p 2023:6379 redis:3.2 redis-server --appendonly yes)
trap "docker rm -f ${POSTGRES} ${REDIS}" EXIT

for tst in ${TESTS[@]}; do
  time stack test $tst
done

for tst in ${TEST_AND_BENCH[@]}; do
  time stack test --bench $tst "--ba=--output=../${tst}.html"
done
