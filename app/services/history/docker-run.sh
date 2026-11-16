#!/bin/sh
set -e

# Secrets arrive as files on a node (docker secrets) or as environment
# variables on Fargate (ECS injects them from Secrets Manager).
if [ -f /run/secrets/postgres_password ]; then
  export postgres_password=$(cat /run/secrets/postgres_password)
fi

echo "Starting history service..."
exec node dist/index.js
