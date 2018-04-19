#!/usr/bin/env bash

declare -i RESULT=0
TESTS=(
  blockapps-ethereum
  blockapps-ethereum-abi
  blockapps-solidity
  blockapps-strato-api
  blockapps-bloc22-server
)

for tst in ${TESTS[@]}; do
  stack test $tst
  RESULT=RESULT+$?
done

exit $RESULT
