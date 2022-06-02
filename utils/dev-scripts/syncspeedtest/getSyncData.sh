#!/usr/bin/env bash

for VARIABLE in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16
do
	docker exec -it strato_strato_1 bash -c 'apt-get update --yes'
	docker exec -it strato_strato_1 bash -c 'apt update --yes'
	docker exec -it strato_strato_1 bash -c 'apt install python3-pip --yes'

	docker exec -it strato_strato_1 bash -c 'pip3 install --upgrade pip'
	docker exec -it strato_strato_1 bash -c 'pip3 install requests'
	docker cp ./getEntireLogs.py strato_strato_1:/var/lib/strato/logs
	docker exec -it strato_strato_1 bash -c 'cd logs && python3 getEntireLogs.py'


	docker cp strato_strato_1:/var/lib/strato/logs/myVmRunnerLog.txt ~/strato-getting-started/myvmRunner${VARIABLE}.txt
	docker cp strato_strato_1:/var/lib/strato/logs/mySequencerLog.txt ~/strato-getting-started/mySeq${VARIABLE}.txt
	docker cp strato_strato_1:/var/lib/strato/logs/myP2pLog.txt ~/strato-getting-started/myP2p${VARIABLE}.txt
	echo "Data log sync scrape complete"
done
