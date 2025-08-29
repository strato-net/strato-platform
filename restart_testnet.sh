for i in {1..5}; do scp "$1" mercata-testnet-node$i:/datadrive/testnet/strato-getting-started/docker-compose.yml && ssh mercata-testnet-node$i "cd /datadrive/testnet/strato-getting-started && sudo ./strato --pull && sudo ./strato --wipe"; done

scp "$1" mercata-testnet-buildtest:/home/ec2-user/strato-getting-started-symlink/docker-compose.yml && ssh mercata-testnet-buildtest "cd /home/ec2-user/strato-getting-started-symlink && sudo ./strato --pull && sudo ./strato --wipe"
scp "$1" mercata-testnet-node-public:/datadrive/testnet/strato-getting-started/docker-compose.yml && ssh mercata-testnet-node-public "cd /datadrive/testnet/strato-getting-started && sudo ./strato --pull && sudo ./strato --wipe"

for i in {1..5}; do ssh mercata-testnet-node$i "cd /datadrive/testnet/strato-getting-started && sudo ./strato-run.sh"; done

ssh mercata-testnet-buildtest "cd /home/ec2-user/strato-getting-started-symlink && sudo ./strato-run.sh"
ssh mercata-testnet-node-public "cd /datadrive/testnet/strato-getting-started && sudo ./strato-run.sh"
