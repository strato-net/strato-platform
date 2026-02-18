#!/bin/bash
#
# Refresh OAuth token if expired
# Can be sourced by other scripts: source refresh-token.sh && ensure_valid_token
#

TOKEN_FILE="${HOME}/.secrets/stratoToken"
OAUTH_FILE="${HOME}/.secrets/oauth_credentials"

# Check if token is expired and refresh if needed
ensure_valid_token() {
    # If no token file, trigger login
    if [ ! -f "$TOKEN_FILE" ]; then
        strato-auth >&2 || return 1
    fi
    
    if [ ! -f "$OAUTH_FILE" ]; then
        echo "Error: OAuth credentials not found at $OAUTH_FILE" >&2
        return 1
    fi
    
    # Get current time and token expiry
    NOW=$(date +%s)
    EXPIRES_AT=$(jq -r '.expires_at // 0' "$TOKEN_FILE")
    
    # If token expires in less than 30 seconds, refresh it
    if [ "$NOW" -ge "$((EXPIRES_AT - 30))" ]; then
        echo "Token expired, refreshing..." >&2
        refresh_token || return 1
    fi
    
    # Return the valid access token
    jq -r '.access_token' "$TOKEN_FILE"
}

refresh_token() {
    local REFRESH_TOKEN=$(jq -r '.refresh_token' "$TOKEN_FILE")
    
    # Source the OAuth credentials (shell variable format)
    source "$OAUTH_FILE"
    local CLIENT_ID="$OAUTH_CLIENT_ID"
    local CLIENT_SECRET="$OAUTH_CLIENT_SECRET"
    
    # Get token URL from discovery endpoint
    local TOKEN_URL=$(curl -s "$OAUTH_DISCOVERY_URL" | jq -r '.token_endpoint')
    
    if [ -z "$REFRESH_TOKEN" ] || [ "$REFRESH_TOKEN" = "null" ]; then
        echo "Error: No refresh token found. Run 'strato-auth' first." >&2
        return 1
    fi
    
    # Make refresh request
    local RESPONSE=$(curl -s -X POST "$TOKEN_URL" \
        -d "client_id=$CLIENT_ID" \
        -d "client_secret=$CLIENT_SECRET" \
        -d "grant_type=refresh_token" \
        -d "refresh_token=$REFRESH_TOKEN")
    
    # Check for error
    if echo "$RESPONSE" | jq -e '.error' >/dev/null 2>&1; then
        local ERROR=$(echo "$RESPONSE" | jq -r '.error_description // .error')
        echo "Error refreshing token: $ERROR" >&2
        echo "Run 'strato-auth' to get new credentials." >&2
        return 1
    fi
    
    # Extract new tokens
    local NEW_ACCESS=$(echo "$RESPONSE" | jq -r '.access_token')
    local NEW_REFRESH=$(echo "$RESPONSE" | jq -r '.refresh_token // empty')
    local EXPIRES_IN=$(echo "$RESPONSE" | jq -r '.expires_in // 300')
    
    if [ -z "$NEW_ACCESS" ] || [ "$NEW_ACCESS" = "null" ]; then
        echo "Error: Failed to get new access token" >&2
        return 1
    fi
    
    # Use old refresh token if new one not provided
    if [ -z "$NEW_REFRESH" ]; then
        NEW_REFRESH="$REFRESH_TOKEN"
    fi
    
    # Calculate new expiry
    local NEW_EXPIRES_AT=$(($(date +%s) + EXPIRES_IN))
    
    # Save new tokens
    jq -n \
        --arg access "$NEW_ACCESS" \
        --arg refresh "$NEW_REFRESH" \
        --argjson expires "$NEW_EXPIRES_AT" \
        '{access_token: $access, refresh_token: $refresh, expires_at: $expires}' \
        > "$TOKEN_FILE"
    
    echo "Token refreshed successfully." >&2
    return 0
}

# If run directly (not sourced), just ensure token is valid and print it
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    ensure_valid_token
fi
