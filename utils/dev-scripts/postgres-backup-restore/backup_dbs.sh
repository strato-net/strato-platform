#!/usr/bin/env bash
set -e
docker exec -i strato_postgres_1 bash -c 'mkdir -p /tmp/backup && pg_dump -U postgres bloc22 -f /tmp/backup/bloc22.sql'
docker exec -i strato_postgres_1 bash -c 'mkdir -p /tmp/backup && pg_dump -U postgres cirrus -f /tmp/backup/cirrus.sql'
mkdir -p ~/db_backups/
docker cp strato_postgres_1:/tmp/backup ~/db_backups/
docker exec -i strato_postgres_1 bash -c 'rm -rf /tmp/backup/'
output_dir=~/db_backups/timestamp-$(date +%s)
mv ~/db_backups/backup ${output_dir}
echo "backed up to ${output_dir}"