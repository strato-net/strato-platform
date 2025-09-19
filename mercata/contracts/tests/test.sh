#!/bin/bash
set -e

# Usage:
# cd mercata/contracts/test
# ./test.sh BadDebt.test.sol

# Run the tests
solid-vm-cli test $1 > /tmp/$1.out
cat /tmp/$1.out

# Calculate statistics
PASSED=$(cat /tmp/$1.out | grep '✅' | wc -l)
FAILED=$(cat /tmp/$1.out | grep '❌' | wc -l)
TOTAL=$((PASSED + FAILED))
echo "--------------------------------"
echo "✅ Passed $PASSED/$TOTAL"
echo "❌ Failed $FAILED/$TOTAL"
