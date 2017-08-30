#!/bin/bash

stratourl=${stratourl:-strato:3000}
echo "stratourl is: ${stratourl}"

until curl stratourl >& /dev/null
do  echo "Waiting for STRATO port 3000 to become available"
    sleep 1
done

cirrus="/usr/lib/strato/cirrus/main.js"
node $cirrus
