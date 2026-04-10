#!/bin/sh

# Generate runtime configuration file
cat > dist/config.js << EOF
window.ENV = {
  LUCKY_ORANGE_SITE_ID: "${LUCKY_ORANGE_SITE_ID:-}",
  GOOGLE_ANALYTICS_ID: "${GOOGLE_ANALYTICS_ID:-}"
};
EOF

exec serve -s dist -l 8080
