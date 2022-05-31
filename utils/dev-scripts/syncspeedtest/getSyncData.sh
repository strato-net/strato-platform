#!/usr/bin/env bash

iteration=$1

docker exec -it strato_strato_1 bash -c 'apt-get update --yes'
docker exec -it strato_strato_1 bash -c 'apt update --yes'
docker exec -it strato_strato_1 bash -c 'apt install python3-pip --yes'

docker exec -it strato_strato_1 bash -c 'pip3 install --upgrade pip'
docker exec -it strato_strato_1 bash -c 'pip3 install requests'
docker cp ~/strato-getting-started/getEntireLogs.py strato_strato_1:/var/lib/strato/logs
docker exec -it strato_strato_1 bash -c 'cd logs && python3 getEntireLogs.py'


docker cp strato_strato_1:/var/lib/strato/logs/myVmRunnerLog.txt ~/strato-getting-started/myvmRunner.txt
docker cp strato_strato_1:/var/lib/strato/logs/mySequencerLog.txt ~/strato-getting-started/mySeq.txt

echo "Data log sync scrape complete"
