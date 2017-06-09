#!/usr/bin/env bash
set -e
set -x

# build the app and serve it via nginx
 npm run build
serve -p 3002 -s build
