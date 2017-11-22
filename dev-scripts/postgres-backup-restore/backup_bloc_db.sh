#!/usr/bin/env bash
set -e
docker exec -it strato_postgres_1 bash -c 'mkdir -p /tmp/backup && pg_dump -U postgres bloc22 -f /tmp/backup/bloc22.sql'
mkdir -p /tmp
docker cp strato_postgres_1:/tmp/backup/bloc22.sql /tmp/
