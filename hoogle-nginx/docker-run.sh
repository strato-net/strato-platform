#!/bin/bash

set -e

OAUTH_CLIENT_ID=${OAUTH_CLIENT_ID:-NULL}
OAUTH_CLIENT_SECRET=${OAUTH_CLIENT_SECRET:-NULL}

# If container is running for the first time - generate config:
if [ ! -f /usr/local/openresty/nginx/conf/nginx.conf ]; then

  if [[ ${OAUTH_CLIENT_ID} = NULL || ${OAUTH_CLIENT_SECRET} = NULL ]] ; then
    echo 'OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET are required for OAuth. Exit'
    exit 5
  fi

  cp /tmp/nginx.tpl.conf /tmp/nginx.conf
  cp /tmp/openid.tpl.lua /tmp/openid.lua
  sed -i 's*<client_id>*'"$OAUTH_CLIENT_ID"'*g' /tmp/openid.lua
  sed -i 's*<client_secret>*'"$OAUTH_CLIENT_SECRET"'*g' /tmp/openid.lua
  
  mv /tmp/nginx.conf /usr/local/openresty/nginx/conf/nginx.conf
  mv /tmp/openid.lua /usr/local/openresty/nginx/lua/openid.lua
fi

echo  'nginx is now running. See the logs below...'
openresty -g "daemon off;"
