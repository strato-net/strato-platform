#!/usr/bin/env bash

# These env variables are needed to prioritize the solc being bundled when available
# NOT REQUIRED FOR DOCKER-ENABLED STACK
#export PATH=$PWD/.basil-work/fakeroot/usr/bin:$PATH
#export LD_LIBRARY_PATH=$PWD/.basil-work/fakeroot/usr/lib:$LD_LIBRARY_PATH

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
