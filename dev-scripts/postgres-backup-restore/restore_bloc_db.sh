#!/usr/bin/env bash
set -e
docker cp /tmp/bloc22.sql strato_postgres_1:/tmp/backup/
docker exec -it strato_postgres_1 bash -c 'psql -U postgres -c \"drop database bloc22\" && psql -U postgres -c \"create database bloc22\" && psql -U postgres -d bloc22 -f /tmp/backup/bloc22.sql'
