#!/usr/bin/env bash
set -e
set -x

SINGLE_NODE=${SINGLE_NODE:-false}
STRATO_GS_MODE=${STRATO_GS_MODE:-0}
ssl=${ssl:-false}

sed -i "s|__NODE_HOST__|$NODE_HOST|g" build/index.html
sed -i "s|__IS_SSL__|$ssl|g" build/index.html

serve -l 3000 build
