#!/usr/bin/env bash

declare -i RESULT=0
TESTS=(
  strato-init
  blockapps-data
  strato-sequencer
)

for tst in ${TESTS[@]}; do
  stack test $tst
  RESULT=RESULT+$?
done

exit $RESULT
