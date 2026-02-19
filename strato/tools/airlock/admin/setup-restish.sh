#!/bin/bash
# Setup restish for STRATO. Usage: ./setup-restish.sh [host:port]
set -e

HOST="${1:-localhost:8081}"

# Mac uses ~/Library/Application Support/restish, Linux uses ~/.config/restish
if [[ "$OSTYPE" == "darwin"* ]]; then
    DIR="$HOME/Library/Application Support/restish"
else
    DIR="$HOME/.config/restish"
fi

mkdir -p "$DIR"

echo "Authenticating..."
strato-auth >/dev/null 2>&1
TOKEN=$(jq -r '.access_token' ~/.secrets/stratoToken)

echo "Fetching swagger from $HOST..."
if ! curl -f -H "Authorization: Bearer $TOKEN" "http://$HOST/strato-api/swagger.json" -o "$DIR/strato-swagger.json" 2>&1; then
    echo "Error: Failed to fetch swagger spec from http://$HOST/strato-api/swagger.json"
    exit 1
fi

echo "Creating auth helper..."
cat > "$DIR/strato-auth-helper.sh" << 'EOF'
#!/bin/bash
strato-auth >/dev/null 2>&1
TOKEN=$(jq -r '.access_token' ~/.secrets/stratoToken)
echo "{\"headers\":{\"Authorization\":[\"Bearer $TOKEN\"]}}"
EOF
chmod +x "$DIR/strato-auth-helper.sh"

echo "Configuring restish..."
CONFIG='{"base":"http://'"$HOST"'/strato-api","spec_files":["'"$DIR"'/strato-swagger.json"],"profiles":{"default":{"auth":{"name":"external-tool","params":{"commandline":"'"$DIR"'/strato-auth-helper.sh","omitbody":"true"}}}}}'

if [ -f "$DIR/apis.json" ]; then
    jq --argjson cfg "$CONFIG" '.strato = $cfg' "$DIR/apis.json" > "$DIR/apis.json.tmp"
    mv "$DIR/apis.json.tmp" "$DIR/apis.json"
else
    echo "{\"strato\":$CONFIG}" > "$DIR/apis.json"
fi

echo "Done. Test: restish strato --help"
