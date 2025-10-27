#!/bin/bash
set -e

echo "⚠️  Reminder: Update the strato-platform code on Oracle1+Oracle2, and the Bridge, IF THEY ARE SUBJECT FOR UPDATE. Pull the required git commit on the VMs first before continuing."
read -p "Press Enter to continue..."

set -x

### STOP ORACLES
ssh mercata-testnet-oracle1 "cd /home/ec2-user/symlink-to-oracle && pm2 delete oracle"
ssh mercata-testnet-oracle2 "cd /home/ec2-user/symlink-to-oracle && pm2 delete oracle"

# TODO: uncomment the bridge stop
#ssh mercata-testnet-bridge "cd /home/ec2-user/symlink-to-bridge && pm2 delete bridge"

for i in {1..5}; do scp "$1" mercata-testnet-node$i:/datadrive/testnet/strato-getting-started/docker-compose.yml && ssh mercata-testnet-node$i "cd /datadrive/testnet/strato-getting-started && sudo ./strato --pull && sudo ./strato --wipe"; done

scp "$1" mercata-testnet-buildtest:/home/ec2-user/bootstrap-docker-symlink/docker-compose.yml && ssh mercata-testnet-buildtest "cd /home/ec2-user/bootstrap-docker-symlink && sudo ./strato --pull && sudo ./strato --wipe"
scp "$1" mercata-testnet-node-app:/datadrive/testnet/strato-getting-started/docker-compose.yml && ssh mercata-testnet-node-app "cd /datadrive/testnet/strato-getting-started && sudo ./strato --pull && sudo ./strato --wipe"

for i in {1..5}; do ssh mercata-testnet-node$i "cd /datadrive/testnet/strato-getting-started && sudo ./strato-run.sh"; done

ssh mercata-testnet-buildtest "cd /home/ec2-user/bootstrap-docker-symlink && sudo ./strato-run.sh"
ssh mercata-testnet-node-app "cd /datadrive/testnet/strato-getting-started && sudo ./strato-run.sh"

# RESTART ORACLES
ssh mercata-testnet-oracle1 "cd /home/ec2-user/symlink-to-oracle && pm2 delete oracle > /dev/null ; pm2 start dist/index.js --name oracle"
ssh mercata-testnet-oracle2 "cd /home/ec2-user/symlink-to-oracle && pm2 delete oracle > /dev/null ; pm2 start dist/index.js --name oracle"

# TODO: uncomment the bridge restart
#ssh mercata-testnet-bridge "cd /home/ec2-user/symlink-to-bridge && pm2 delete bridge ; pm2 start npm --name bridge -- run start"

set +x
echo "All done. Check the oracle-error.flag files on both oracles a d bridge-error.flag file on the bridge for any new errors."
