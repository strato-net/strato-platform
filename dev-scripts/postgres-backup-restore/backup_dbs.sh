#!/usr/bin/env bash
set -e
docker exec -it strato_postgres_1 bash -c 'mkdir -p /tmp/backup && pg_dump -U postgres bloc22 -f /tmp/backup/bloc22.sql'
docker exec -it strato_postgres_1 bash -c 'mkdir -p /tmp/backup && pg_dump -U postgres cirrus -f /tmp/backup/cirrus.sql' || true
mkdir -p db_backups/
docker cp strato_postgres_1:/tmp/backup db_backups/
docker exec -it strato_postgres_1 bash -c 'rm -rf /tmp/backup/'
echo "backed up to $(pwd)/db_backups/"