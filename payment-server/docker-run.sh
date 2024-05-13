#!/bin/sh
set -e

export DOCKERIZED="true"

echo 'Starting Payment Server...'
yarn start
