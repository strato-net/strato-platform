#!/usr/bin/env bash
set -e
set -x

sed -i "s|__NODE_NAME__|$NODE_NAME|g" build/index.html
sed -i "s|__NODE_URL__|$NODE_URL|g" build/index.html

serve --port 3000 build
