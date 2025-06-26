#!/bin/bash

# Load environment variables
source .env

# Export all required variables
export OAUTH_DISCOVERY_URL
export OAUTH_CLIENT_ID
export OAUTH_CLIENT_SECRET
export USERNAME
export PASSWORD
export STRATO_NODE_URL
export PRICE_ORACLE_ADDRESS
export ALCHEMY_API_KEY

# Build and start the service
npm run build
node dist/index.js 