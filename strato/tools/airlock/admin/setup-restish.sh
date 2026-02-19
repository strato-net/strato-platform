#!/bin/bash
# Setup restish for STRATO. Usage: ./setup-restish.sh [host:port]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST="${1:-localhost:8081}"

# Mac uses ~/Library/Application Support/restish, Linux uses ~/.config/restish
if [[ "$OSTYPE" == "darwin"* ]]; then
    DIR="$HOME/Library/Application Support/restish"
else
    DIR="$HOME/.config/restish"
fi

# Auth helper goes in a path without spaces
HELPER_DIR="$HOME/.local/bin"

mkdir -p "$DIR"
mkdir -p "$HELPER_DIR"

echo "Copying OpenAPI spec..."
cp "$SCRIPT_DIR/restish/strato-openapi3.json" "$DIR/"

echo "Creating auth helper..."
cat > "$HELPER_DIR/strato-auth-helper.sh" << 'EOF'
#!/bin/bash
strato-auth >/dev/null 2>&1
TOKEN=$(jq -r '.access_token' ~/.secrets/stratoToken)
echo "{\"headers\":{\"Authorization\":[\"Bearer $TOKEN\"]}}"
EOF
chmod +x "$HELPER_DIR/strato-auth-helper.sh"

echo "Configuring restish..."
CONFIG='{"base":"http://'"$HOST"'/strato-api","spec_files":["'"$DIR"'/strato-openapi3.json"],"profiles":{"default":{"auth":{"name":"external-tool","params":{"commandline":"'"$HELPER_DIR"'/strato-auth-helper.sh","omitbody":"true"}}}}}'

if [ -f "$DIR/apis.json" ]; then
    jq --argjson cfg "$CONFIG" '.strato = $cfg' "$DIR/apis.json" > "$DIR/apis.json.tmp"
    mv "$DIR/apis.json.tmp" "$DIR/apis.json"
else
    echo "{\"strato\":$CONFIG}" > "$DIR/apis.json"
fi

echo "Done. Test: restish strato --help"
