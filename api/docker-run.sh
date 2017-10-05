#!/usr/bin/env bash
set -e
set -x

sleep 3 # TODO: sleep until 'curl postgres:5432' exit code = 52

npm start