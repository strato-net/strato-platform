#!/bin/bash

set -e

LUCKY_ORANGE_SITE_ID=${LUCKY_ORANGE_SITE_ID:-}

# Replace the placeholder in index.html at runtime
if [ -f /app/dist/index.html ]; then
  echo "Configuring Lucky Orange site ID..."
  sed -i "s|__LUCKY_ORANGE_SITE_ID__|$LUCKY_ORANGE_SITE_ID|g" /app/dist/index.html
else
  echo "Warning: /app/dist/index.html not found"
fi

echo "Starting UI server..."
exec serve -s dist -l 8080
