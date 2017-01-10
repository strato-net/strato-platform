#!/bin/bash

set -e
echo "Starting to backup from `hostname`: backing up blockchain data from silo_strato_1 container and users and meta folders from silo_bloc_1 container."

# TODO: Once we've a mechanism to collect backups in a central S3/Azure store, cleanup any pre-existing backups from node host
# TODO: Re-factor this based on host's volume-mapping (current implementation) Vs. volume-container (ideal, proposed)
docker exec -it silo_strato_1 bash -c 'rm -rf /tmp/backup_*'
docker exec -it silo_bloc_1 bash -c 'rm -rf /tmp/backup_*'

# Run backup command (specific command for strato) within strato container and collect blocks into a file
docker exec -it silo_strato_1 bash -c 'cd /var/lib/strato; strato-block-backup > /tmp/backup_strato_block'
# backup and tar users and meta folder from bloc container
docker exec -it silo_bloc_1 bash -c 'cd /var/run/strato/bloc-server/app/; tar -czvf /tmp/backup_bloc_users.tar.gz users; tar -czvf /tmp/backup_bloc_meta.tar.gz meta'
# docker exec -it silo_bloc_1 bash -c 'cd /var/run/strato/bloc-server/app/; tar -czvf /tmp/backup_bloc_meta.tar.gz meta'

mkdir /tmp/backup-`hostname`-`date +%Y-%m-%d`
docker cp silo_strato_1:/tmp/backup_strato_block /tmp/backups/backup-`hostname`-`date +%Y-%m-%d`/
docker cp silo_bloc_1:/tmp/backup_bloc_meta.tar.gz /tmp/backups/backup-`hostname`-`date +%Y-%m-%d`/
docker cp silo_bloc_1:/tmp/backup_bloc_users.tar.gz /tmp/backups/backup-`hostname`-`date +%Y-%m-%d`/

cd /tmp/backups/
tar -czvf backup-`hostname`-`date +%Y-%m-%d`.tar.gz backup-`hostname`-`date +%Y-%m-%d`
echo "Backup complete. Backup Filename: /tmp/backups/backup-`hostname`-`date +%Y-%m-%d`.tar.gz"
