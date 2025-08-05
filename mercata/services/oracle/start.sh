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
export ORACLE_CONTRACT_NAME
export ALCHEMY_API_KEY
export METALS_API_KEY
export METALPRICE_API_KEY
export COINMARKETCAP_API_KEY

# Build and start the service
npm run build
node dist/index.js 