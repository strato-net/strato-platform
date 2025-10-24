#!/bin/bash
set -ex

for i in {1..5}; do scp "$1" mercata-testnet-node$i:/datadrive/testnet/strato-getting-started/docker-compose.yml && ssh mercata-testnet-node$i "cd /datadrive/testnet/strato-getting-started && sudo ./strato --pull && sudo ./strato --wipe && sudo ./strato-run.sh" && echo "Completed node $i" && read -r blah; done

scp "$1" mercata-testnet-buildtest:/home/ec2-user/bootstrap-docker-symlink/docker-compose.yml && ssh mercata-testnet-buildtest "cd /home/ec2-user/bootstrap-docker-symlink && sudo ./strato --pull && sudo ./strato --wipe && sudo ./strato-run.sh"
scp "$1" mercata-testnet-node-app:/datadrive/testnet/strato-getting-started/docker-compose.yml && ssh mercata-testnet-node-app "cd /datadrive/testnet/strato-getting-started && sudo ./strato --pull && sudo ./strato --wipe && sudo ./strato-run.sh"

# Restarting oracles
ssh mercata-testnet-oracle1 "cd /home/ec2-user/symlink-to-oracle && pm2 delete oracle && pm2 start dist/index.js --name oracle"
echo "Network and the oracles are up. Now sleeping 7.5 minutes to start oracle2..."
sleep 450
ssh mercata-testnet-oracle2 "cd /home/ec2-user/symlink-to-oracle && pm2 delete oracle && pm2 start dist/index.js --name oracle"
echo "All done. Check the oracle-error.flag files on both oracles for errors to clean up."
