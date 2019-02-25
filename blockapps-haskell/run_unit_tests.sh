#!/usr/bin/env bash

set -e

declare -i RESULT=0
TESTS=(
  blockapps-ethereum
  blockapps-solidity
  blockapps-strato-api
  blockapps-bloc22-server
  blockapps-bloc22-api
  slipstream
  solid-vm-model
)

for tst in ${TESTS[@]}; do
  stack test $tst
  RESULT=RESULT+$?
done

exit $RESULT
