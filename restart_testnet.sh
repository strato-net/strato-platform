#!/bin/bash
set -ex

### STOP ORACLES
ssh mercata-testnet-oracle1 "cd /home/ec2-user/symlink-to-oracle && pm2 delete oracle"
ssh mercata-testnet-oracle2 "cd /home/ec2-user/symlink-to-oracle && pm2 delete oracle"

# TODO: stop the bridge

for i in {1..5}; do scp "$1" mercata-testnet-node$i:/datadrive/testnet/strato-getting-started/docker-compose.yml && ssh mercata-testnet-node$i "cd /datadrive/testnet/strato-getting-started && sudo ./strato --pull && sudo ./strato --wipe"; done

scp "$1" mercata-testnet-buildtest:/home/ec2-user/bootstrap-docker-symlink/docker-compose.yml && ssh mercata-testnet-buildtest "cd /home/ec2-user/bootstrap-docker-symlink && sudo ./strato --pull && sudo ./strato --wipe"
scp "$1" mercata-testnet-node-app:/datadrive/testnet/strato-getting-started/docker-compose.yml && ssh mercata-testnet-node-app "cd /datadrive/testnet/strato-getting-started && sudo ./strato --pull && sudo ./strato --wipe"

for i in {1..5}; do ssh mercata-testnet-node$i "cd /datadrive/testnet/strato-getting-started && sudo ./strato-run.sh"; done

ssh mercata-testnet-buildtest "cd /home/ec2-user/bootstrap-docker-symlink && sudo ./strato-run.sh"
ssh mercata-testnet-node-app "cd /datadrive/testnet/strato-getting-started && sudo ./strato-run.sh"

# RESTART ORACLES
ssh mercata-testnet-oracle1 "cd /home/ec2-user/symlink-to-oracle && pm2 delete oracle ; pm2 start dist/index.js --name oracle"
ssh mercata-testnet-oracle2 "cd /home/ec2-user/symlink-to-oracle && pm2 delete oracle ; pm2 start dist/index.js --name oracle"
echo "All done. Check the oracle-error.flag files on both oracles a d bridge-error.flag file on the bridge for any new errors."

# TODO: restart the bridge
