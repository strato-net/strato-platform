#!/bin/bash

if [[ $# -ne 3 ]]
then echo >&2 "Usage: $0 <name> <email> <api key>"
     exit 1;
fi

# This script MUST be located in /home/strato
cd /home/strato

. set-params.sh

export streakName=$1
export streakEmail=$2
export streakAPIToken=$3

docker-compose -f streak.yml up
