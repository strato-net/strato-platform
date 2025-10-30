#!/usr/bin/env sh
set -e
set -x

ssl=${ssl:-false}

# Process template variables in config.js file
sed -i "s|__NODE_HOST__|$NODE_HOST|g" build/scripts/config.js
sed -i "s|__OAUTH_ENABLED__|true|g" build/scripts/config.js # Temporary measure required until the non-oauth code is fully removed from SMD, including the tests
sed -i "s|__IS_SSL__|$ssl|g" build/scripts/config.js
sed -i "s|__STRATO_VERSION__|$STRATO_VERSION|g" build/scripts/config.js
sed -i "s|__POLLING_FREQUENCY__|$POLLING_FREQUENCY|g" build/scripts/config.js

NO_UPDATE_CHECK=1 serve --single -l 3002 build
