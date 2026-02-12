#!/bin/bash
#
# External auth helper for restish
# Reads stdin (request JSON), outputs modified request with fresh auth header
#

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/refresh-token.sh"

# Get valid token (auto-refreshes if needed)
TOKEN=$(ensure_valid_token 2>/dev/null)

if [ -z "$TOKEN" ]; then
    echo '{"headers": {}}' 
    exit 1
fi

# Output the auth header in restish's expected format
cat << EOF
{
  "headers": {
    "Authorization": ["Bearer $TOKEN"]
  }
}
EOF
