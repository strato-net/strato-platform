#!/usr/bin/env bash

echo 'Starting ui server...'

npx react-inject-env set && serve --single build
