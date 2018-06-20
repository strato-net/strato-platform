#!/usr/bin/env bash

declare -i RESULT=0
TESTS=(
  blockapps-data
  ethereum-rlp
  strato-init
  strato-sequencer
)

for tst in ${TESTS[@]}; do
  stack test $tst
  RESULT=RESULT+$?
done

exit $RESULT
