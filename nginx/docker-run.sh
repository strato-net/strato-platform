#!/bin/bash

set -e

OAUTH_DISCOVERY_URL=${OAUTH_DISCOVERY_URL:-NULL}
OAUTH_CLIENT_ID=${OAUTH_CLIENT_ID:-NULL}
OAUTH_CLIENT_SECRET=${OAUTH_CLIENT_SECRET:-NULL}
HOST_IP=${HOST_IP:-host.docker.internal}

# If container is running for the first time - generate config:
if [ ! -f /usr/local/openresty/nginx/conf/nginx.conf ]; then
  ########
  ### Check the validity of variables combination
  ########
  if [[ ${OAUTH_DISCOVERY_URL} = NULL || ${OAUTH_CLIENT_ID} = NULL || ${OAUTH_CLIENT_SECRET} = NULL ]] ; then
    echo 'OAUTH_DISCOVERY_URL, OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET are required for OAuth. Exit'
    exit 4
  fi

  ########
  ### Generate nginx.conf from template according to configuration provided
  ########
  cp /tmp/nginx.tpl.conf /tmp/nginx.conf

  # Remove SSL lines if deployment is not SSL-enabled
  if [ "$ssl" != true ]; then
    sed -i '/#TEMPLATE_MARK_SSL/d' /tmp/nginx.conf
  fi
  
  DOCKER_NETWORK_CIDR=$(ip route | awk '/src/ {print $1}')
  sed -i "s|__DOCKER_NETWORK_CIDR__|$DOCKER_NETWORK_CIDR|g" /tmp/nginx.conf
  sed -i "s|__HOST_IP__|$HOST_IP|g" /tmp/nginx.conf

  ########
  ### Generate .lua scripts from templates according to configuration provided
  ########
  cp /tmp/openid.tpl.lua /tmp/openid.lua
  sed -i 's*<OAUTH_DISCOVERY_URL_PLACEHOLDER>*'"$OAUTH_DISCOVERY_URL"'*g' /tmp/openid.lua
  sed -i 's*<CLIENT_ID_PLACEHOLDER>*'"$OAUTH_CLIENT_ID"'*g' /tmp/openid.lua
  sed -i 's*<CLIENT_SECRET_PLACEHOLDER>*'"$OAUTH_CLIENT_SECRET"'*g' /tmp/openid.lua
  sed -i 's*<OAUTH_SCOPE_PLACEHOLDER>*openid profile*g' /tmp/openid.lua

  if [ "$ssl" = true ] ; then
    sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/yes/g' /tmp/openid.lua
    sed -i 's/<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>/https/g' /tmp/openid.lua
  else
    sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/no/g' /tmp/openid.lua
    sed -i 's/<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>/http/g' /tmp/openid.lua
  fi

  ########
  ### Move generated files to nginx dirs
  ########
  mv /tmp/nginx.conf /usr/local/openresty/nginx/conf/nginx.conf

  mv /tmp/openid.lua /usr/local/openresty/nginx/lua/openid.lua

  if [ "$ssl" = true ] ; then
    cp -r /tmp/ssl/server.pem /etc/ssl/certs/server.pem
    cp -r /tmp/ssl/server.key /etc/ssl/private/server.key
  fi
fi

echo  'nginx is now running. See the logs below...'
openresty -g "daemon off;"
