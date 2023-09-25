#!/usr/bin/env sh
set -e
set -x

ssl=${ssl:-false}

sed -i "s|__NODE_HOST__|$NODE_HOST|g" build/index.html
sed -i "s|__NODE_NAME__|$NODE_NAME|g" build/index.html
sed -i "s|__OAUTH_ENABLED__|true|g" build/index.html # Temporary measure required until the non-oauth code is fully removed from SMD, including the tests
sed -i "s|__IS_SSL__|$ssl|g" build/index.html
sed -i "s|__STRATO_VERSION__|$STRATO_VERSION|g" build/index.html

NO_UPDATE_CHECK=1 serve --single -l 3002 build
