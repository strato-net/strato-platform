#!/usr/bin/env bash

iteration=$1


./strato --drop-chains
OAUTH_ENABLED=true \
OAUTH_CLIENT_ID=dev \
OAUTH_CLIENT_SECRET='d5e67b8c-4fbf-42c6-a8d9-29a4dd13575f' \
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration \
OAUTH_JWT_USERNAME_PROPERTY=email \
PASSWORD=123 \
vmDebug=true \
wsDebug=true \
svmTrace=true \
BOOT_NODE_IP='18.235.213.241' \
networkID=1720007323 \
validators='["9db9b9a5045f24912ece22bbdbeca1bc2884f3f7"]' \
blockstanbulAdmins='["9db9b9a5045f24912ece22bbdbeca1bc2884f3f7"]' \
./strato --blockstanbul

docker exec -it strato_strato_1 bash -c 'apt-get update --yes'
docker exec -it strato_strato_1 bash -c 'apt update --yes'
docker exec -it strato_strato_1 bash -c 'apt install python3-pip --yes'

docker exec -it strato_strato_1 bash -c 'pip3 install --upgrade pip'
docker exec -it strato_strato_1 bash -c 'pip3 install requests'
docker cp ~/strato-getting-started/getSyncData.py strato_strato_1:/var/lib/strato
docker cp ~/strato-getting-started/getEntireLogs.py strato_strato_1:/var/lib/strato/logs
docker exec -it strato_strato_1 bash -c 'cd logs && python3 getEntireLogs.py'


docker cp strato_strato_1:/var/lib/strato/logs/myVmRunnerLog.txt ~/strato-getting-started/myvmRunner.txt
docker cp strato_strato_1:/var/lib/strato/logs/mySequencerLog.txt ~/strato-getting-started/mySeq.txt

echo "Data log sync scrape complete"
