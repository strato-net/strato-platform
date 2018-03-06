#!/usr/bin/env bash
set -e
docker exec -it strato_strato_1 bash -c 'mkdir -p /tmp/backup && PGPASSWORD="api" pg_dump -U postgres -h postgres bloc22 -f /tmp/backup/bloc22.sql'
mkdir -p /tmp
docker cp strato_strato_1:/tmp/backup/bloc22.sql /tmp/
