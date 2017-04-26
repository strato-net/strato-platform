set -e
echo "Started backup..."
# TODO: Once we've a mechanism to collect backups in a central S3/Azure store, cleanup any pre-existing backups from node host
# TODO: Re-factor this based on host's volume-mapping (current implementation) Vs. volume-container (ideal, proposed)
docker exec -it silo_strato_1 bash -c 'rm -rf /tmp/backup_*'
docker exec -it silo_bloc_1 bash -c 'rm -rf /tmp/backup_*'

echo "Backing up blockchain data from silo_strato_1 container and users and meta folders from silo_bloc_1 container..."
# Run backup command (specific command for strato) within strato container and collect blocks into a file
docker exec -it silo_strato_1 bash -c 'cd /var/lib/strato; strato-block-backup > /tmp/backup_strato_block'
# backup and tar users and meta folder from bloc container
# Ignore failures if meta and user data isn't found in bloc container on a node.
set +e
docker exec -it silo_bloc_1 bash -c 'cd /var/run/strato/bloc-server/app/; tar -czvf /tmp/backup_bloc_users.tar.gz users; tar -czvf /tmp/backup_bloc_meta.tar.gz meta'

echo "Backing up cirrus contract data from silo_postgres-cirrus_1 container..."
docker exec -it silo_postgres-cirrus_1 bash -c 'pg_dump --table contract -U postgres cirrus -f /tmp/backup/contract.sql'

echo "Running docker cp to collect backup files from strato and bloc ontainers..."
mkdir -p /tmp/backup/backup-`hostname`-`date +%Y-%m-%d`
docker cp silo_strato_1:/tmp/backup_strato_block /tmp/backup/backup-`hostname`-`date +%Y-%m-%d`/
docker cp silo_bloc_1:/tmp/backup_bloc_meta.tar.gz /tmp/backup/backup-`hostname`-`date +%Y-%m-%d`/
docker cp silo_bloc_1:/tmp/backup_bloc_users.tar.gz /tmp/backup/backup-`hostname`-`date +%Y-%m-%d`/
echo "docker cp completed"

cd /tmp/backup/backup-`hostname`-`date +%Y-%m-%d`
# copy latest cirrus contract table data to the backup archive
cp /tmp/backup/contract.sql .
# Extract metadata tars in the backup folder
tar -xzvf backup_bloc_users.tar.gz
tar -xzvf backup_bloc_meta.tar.gz
rm -rf *.tar.gz
cd ../
tar -czvf backup-`hostname`-`date +%Y-%m-%d`.tar.gz backup-`hostname`-`date +%Y-%m-%d`
echo "Backup complete. Backup Filename: /tmp/backup/backup-`hostname`-`date +%Y-%m-%d`.tar.gz"
