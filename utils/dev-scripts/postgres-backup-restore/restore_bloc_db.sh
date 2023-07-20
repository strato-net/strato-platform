#!/usr/bin/env bash
# TODO: check before use (not universal)
set -e
docker exec -it strato-postgres-1 mkdir -p /tmp/backup
docker cp /tmp/strato.sql strato-postgres-1:/tmp/backup/
docker exec -it strato-postgres-1 bash -c 'psql -U postgres -c "drop database strato" && psql -U postgres -c "create database strato" && psql -U postgres -d strato -f /tmp/backup/strato.sql'
