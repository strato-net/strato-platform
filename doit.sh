#!/bin/bash

stratourl=${stratourl:-http://strato:3000}
echo "stratourl is: ${stratourl}"

until curl ${stratourl} >& /dev/null
do  echo "Waiting for STRATO to become available at ${stratourl}"
    sleep 1
done

echo "Connected to STRATO"

cirrus="/usr/lib/strato/cirrus/main.js"
node $cirrus
