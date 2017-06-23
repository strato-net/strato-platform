#!/usr/bin/env bash

# STRATO E2E tests
# Prerequsites:
# 1) Node.js with npm installed on the host
# 2) STRATO instance running on the host

set -e

cd tests
npm i
node_modules/mocha/bin/mocha e2e/* --config config/localhost.config.yaml
