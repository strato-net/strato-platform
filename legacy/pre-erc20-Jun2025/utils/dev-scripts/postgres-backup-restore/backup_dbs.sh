#!/usr/bin/env bash
# Can be ran from any path.
# 1. Makes the dumps of both: `bloc22` and `cirrus` dbs
# 2. creates `~/db_backups/` folder if doesn't exist
# 3. copies the dumps into it with the timestamped dir name
# 4. cleans dump in postgres container
set -e
docker exec -i strato-postgres-1 bash -c 'mkdir -p /tmp/backup && pg_dump -U postgres bloc22 -f /tmp/backup/bloc22.sql'
docker exec -i strato-postgres-1 bash -c 'mkdir -p /tmp/backup && pg_dump -U postgres cirrus -f /tmp/backup/cirrus.sql'
mkdir -p ~/db_backups/
docker cp strato-postgres-1:/tmp/backup ~/db_backups/
docker exec -i strato-postgres-1 bash -c 'rm -rf /tmp/backup/'
output_dir=~/db_backups/timestamp-$(date +%s)
mv ~/db_backups/backup ${output_dir}
echo "backed up to ${output_dir}"
