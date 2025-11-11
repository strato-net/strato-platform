#!/bin/sh

# Generate runtime configuration file
cat > dist/config.js << EOF
window.ENV = {
  LUCKY_ORANGE_SITE_ID: "${LUCKY_ORANGE_SITE_ID:-}"
};
EOF

serve -s dist -l 8080
