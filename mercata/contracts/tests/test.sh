#!/bin/bash
set -e

# Usage:
# cd mercata/contracts/test
# ./test.sh BadDebt.test.sol

logfile="/tmp/$(basename $1).solidvmtest.out"

# Run the tests
solid-vm-cli test $1 > $logfile
cat $logfile

# Calculate statistics
PASSED=$(cat $logfile | grep '✅' | wc -l)
FAILED=$(cat $logfile | grep '❌' | wc -l)
TOTAL=$((PASSED + FAILED))
echo "--------------------------------"
echo "✅ Passed $PASSED/$TOTAL"
echo "❌ Failed $FAILED/$TOTAL"
