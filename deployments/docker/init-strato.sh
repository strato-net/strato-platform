#!/bin/bash

. set-params.sh

docker-compose up global-db

./start-strato.sh $@

