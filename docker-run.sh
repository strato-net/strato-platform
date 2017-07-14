#!/usr/bin/env bash
set -e
set -x

sed -i "s|__NODE_NAME__|$NODE_NAME|g" build/index.html
sed -i "s|__BLOC_URL__|$BLOC_URL|g" build/index.html
sed -i "s|__STRATO_URL__|$STRATO_URL|g" build/index.html
sed -i "s|__STRATO_DOC_URL__|$STRATO_DOC_URL|g" build/index.html
sed -i "s|__BLOC_DOC_URL__|$BLOC_DOC_URL|g" build/index.html
sed -i "s|__CIRRUS_URL__|$CIRRUS_URL|g" build/index.html

serve --port 3002 build
