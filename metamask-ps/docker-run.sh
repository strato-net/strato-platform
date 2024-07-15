#!/bin/sh
set -e

export DOCKERIZED="true"

echo 'Starting payment server (Metamask)...'
yarn start
