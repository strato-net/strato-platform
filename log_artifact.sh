#!/usr/bin/env bash

if [ $# -lt 1 ]; then
  echo "usage: log_artifact.sh <out_dir>"
  exit 1
fi

OUTDIR=$1

declare -A fsLogs
fsLogs[bloc]=/logs
fsLogs[strato]=/var/lib/strato/logs

declare -a cnLogs
cnLogs=(nginx smd dappstore apex postgrest bloc vault-wrapper strato kafka redis postgres prometheus zookeeper docs)

for cnName in "${!fsLogs[@]}"; do
  dir="${fsLogs[$cnName]}"
  docker exec "strato_${cnName}_1" tar -C $dir -czvf "/tmp/${cnName}.tar.gz" .
  docker cp "strato_${cnName}_1:/tmp/${cnName}.tar.gz" $OUTDIR
done

for cnName in "${cnLogs[@]}"; do
  docker logs -t "strato_${cnName}_1" &> "$OUTDIR/$cnName.log"
done
