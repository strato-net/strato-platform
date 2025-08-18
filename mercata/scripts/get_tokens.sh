#!/bin/bash
# Usage: prepare .secrets and .env.static, then run this script to get .env
set -e

LOGIN_URL='https://keycloak.blockapps.net/auth/realms/mercata/protocol/openid-connect/token'

source .secrets

# Error if not defined
if [ -z "$OAUTH_CLIENT_SECRET" ]; then
    echo "Error: OAUTH_CLIENT_SECRET is not defined"
    exit 1
fi
if [ -z "$ADMIN_USERNAME" ]; then
    echo "Error: ADMIN_USERNAME is not defined"
    exit 1
fi
if [ -z "$ADMIN_PASSWORD" ]; then
    echo "Error: ADMIN_PASSWORD is not defined"
    exit 1
fi
if [ -z "$NORMAL_USERNAME" ]; then
    echo "Error: NORMAL_USERNAME is not defined"
    exit 1
fi
if [ -z "$NORMAL_PASSWORD" ]; then
    echo "Error: NORMAL_PASSWORD is not defined"
    exit 1
fi

USERNAME=$ADMIN_USERNAME
PW=$ADMIN_PASSWORD
echo "ADMIN_TOKEN="$(curl -sL "$LOGIN_URL" -H 'Content-Type: application/x-www-form-urlencoded' -H "Authorization: Basic $(echo -n "localhost:$OAUTH_CLIENT_SECRET" | base64 -w0)" -d 'grant_type=password' -d "username=$USERNAME" -d "password=$PW" | jq -r .access_token) \
    > .admin_token

USERNAME=$NORMAL_USERNAME
PW=$NORMAL_PASSWORD
echo "USER_TOKEN="$(curl -sL "$LOGIN_URL" -H 'Content-Type: application/x-www-form-urlencoded' -H "Authorization: Basic $(echo -n "localhost:$OAUTH_CLIENT_SECRET" | base64 -w0)" -d 'grant_type=password' -d "username=$USERNAME" -d "password=$PW" | jq -r .access_token) \
    > .user_token

cat .env.static .admin_token .user_token > .env
rm .admin_token .user_token
