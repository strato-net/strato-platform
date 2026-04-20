#!/usr/bin/env sh
set -e
set -x

# Process template variables in config.js file
sed -i "s|__OAUTH_ENABLED__|true|g" build/scripts/config.js
sed -i "s|__STRATO_VERSION__|$STRATO_VERSION|g" build/scripts/config.js
sed -i "s|__POLLING_FREQUENCY__|$POLLING_FREQUENCY|g" build/scripts/config.js

exec env NO_UPDATE_CHECK=1 serve --single -l 3002 build
