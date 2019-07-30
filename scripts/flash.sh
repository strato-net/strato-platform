#!/usr/bin/env bash
set +x
if [ $# -ne 1 ]; then
 >&2 echo "usage: ${0} <hostname>"
 exit 1
fi

HOST=$1
ssh $HOST mkdir -p bin
for bin in qs spsql blog dlf stlog esql grab_dc.sh view-tracker.sh force_docker_purge_all; do
  scp ~/bin/${bin} $HOST:./bin
  ssh ${HOST} chmod +x bin/${bin}
done
