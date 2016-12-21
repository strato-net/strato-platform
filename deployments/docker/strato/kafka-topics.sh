#!/bin/bash

netcat kafka 1124 <<< "$@" | read kafkaExit kafkaOut
echo $kafkaOut
exit $kafkaExit
