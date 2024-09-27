#!/usr/bin/env bash

set -e
set -x

declare -i RESULT=0

# There's a good chance that strato-getting-started is also running, so
# we change redis's port to avoid a conflict.
REDIS=$(docker run -d -p 2023:6379 redis:3.2 redis-server --appendonly yes)
trap "docker rm -f ${REDIS}" EXIT

cd strato

stack test $5\
      blockapps-data \
      blockapps-init \
      blockapps-mpdbs \
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
      merkle-patricia-db \
      seqevents \
      slipstream \
      solid-vm \
      solid-vm-model \
      solid-vm-parser \
      source-tools \
      strato-index \
      strato-genesis \
      strato-model \
      strato-redis-blockdb \
      strato-sequencer \
      vm-runner

#      strato-lite \

stack test \
  highway/ --test-arguments="--awsaccesskeyid $1 --awssecretaccesskey $2 --awss3bucket $3 --highwayUrl $4"

if [ $5 = --coverage ]
then
      rm -rf hpc
      mkdir hpc
      cp -r $(stack path --local-hpc-root) .
fi
