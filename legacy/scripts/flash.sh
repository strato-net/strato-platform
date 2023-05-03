#!/usr/bin/env bash
set +x
if [ $# -ne 1 ]; then
 >&2 echo "usage: ${0} <hostname>"
 exit 1
fi

HOST=$1
ssh $HOST mkdir -p bin
cd ~
# Assumes that on the host, they are located in ~/bin/ and on the destination
# they should go there as well.
BINS="bin/qs bin/spsql bin/blog bin/dlf bin/stlog bin/stwait bin/view-tracker.sh"
scp $BINS $HOST:./bin
ssh $HOST chmod +x $BINS
