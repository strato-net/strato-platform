#!/bin/sh
set -e

# Secrets arrive as files on a node (docker secrets) or as environment
# variables on Fargate (ECS injects them from Secrets Manager).
if [ -f /run/secrets/postgres_password ]; then
  export postgres_password=$(cat /run/secrets/postgres_password)
fi
if [ -f /run/secrets/partner_api_keys ]; then
  export PARTNER_API_KEYS=$(cat /run/secrets/partner_api_keys)
fi
if [ -f /run/secrets/partner_internal_key ]; then
  export PARTNER_INTERNAL_KEY=$(cat /run/secrets/partner_internal_key)
fi

echo "Starting partner referrals service..."
exec node dist/index.js
