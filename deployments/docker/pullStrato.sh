#!/bin/bash

. set-params.sh

docker-compose pull
docker-compose -f streak.yml pull
