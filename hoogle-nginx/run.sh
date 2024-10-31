#!/bin/bash
set -e

sudo \
  OAUTH_CLIENT_ID=__MY_CLIENT_ID__ \
  OAUTH_CLIENT_SECRET=__MY_CLIENT_SECRET__ \
  docker compose -p proxy up -d --build
