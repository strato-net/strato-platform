#!/bin/bash

num=${1:-1}
shift

. set-params.sh

docker-compose scale strato-observer=$num
