#!/usr/bin/env bash
# TODO: check before use (not universal)
set -e
docker exec -it strato-postgres-1 mkdir -p /tmp/backup
docker cp /tmp/bloc22.sql strato-postgres-1:/tmp/backup/
docker exec -it strato-postgres-1 bash -c 'psql -U postgres -c "drop database bloc22" && psql -U postgres -c "create database bloc22" && psql -U postgres -d bloc22 -f /tmp/backup/bloc22.sql'
