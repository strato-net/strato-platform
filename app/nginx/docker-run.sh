#!/bin/bash

set -e

OAUTH_DISCOVERY_URL=${OAUTH_DISCOVERY_URL:-NULL}
OAUTH_CLIENT_ID=${OAUTH_CLIENT_ID:-NULL}
OAUTH_CLIENT_SECRET=${OAUTH_CLIENT_SECRET:-NULL}
NODE_URL=${NODE_URL:-NULL}
HOST_IP=${HOST_IP:-host.docker.internal}
DOCKERIZED_APP=${DOCKERIZED_APP:-true}
# Edge Redis for CSRF tokens and sessions, shared by every nginx instance in
# front of the app tier. Empty EDGE_REDIS_HOST keeps both in this instance's
# memory (fine for a single copy, wrong behind a load balancer).
EDGE_REDIS_HOST=${EDGE_REDIS_HOST:-}
EDGE_REDIS_PORT=${EDGE_REDIS_PORT:-6379}
# Session cookie secret: from the mounted secret file unless given directly.
if [[ -z "${SESSION_SECRET:-}" && -f /run/secrets/session_secret ]]; then
    SESSION_SECRET=$(tr -d '[:space:]' < /run/secrets/session_secret)
fi
SESSION_SECRET=${SESSION_SECRET:-}

# If container is running for the first time - generate config:
if [ ! -f /usr/local/openresty/nginx/conf/nginx.conf ]; then
  ########
  ### Check the validity of variables combination
  ########
  if [[ ${OAUTH_DISCOVERY_URL} = NULL || ${OAUTH_CLIENT_ID} = NULL || ${OAUTH_CLIENT_SECRET} = NULL ]] ; then
    echo 'OAUTH_DISCOVERY_URL, OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET are required for OAuth. Exit'
    exit 4
  fi
  if [[ ${NODE_URL} = NULL ]] ; then
    echo 'NODE_URL is required to proxy /rpc to the upstream STRATO node. Exit'
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
  
  if [[ -z "$EDGE_REDIS_HOST" ]]; then
    sed -i '/#TEMPLATE_MARK_EDGE_REDIS/d' /tmp/nginx.conf
  else
    sed -i 's/[[:space:]]*#TEMPLATE_MARK_EDGE_REDIS//g' /tmp/nginx.conf
  fi
  if [[ -z "$SESSION_SECRET" ]]; then
    sed -i '/#TEMPLATE_MARK_SESSION_SECRET/d' /tmp/nginx.conf
  else
    sed -i 's/[[:space:]]*#TEMPLATE_MARK_SESSION_SECRET//g' /tmp/nginx.conf
  fi
  sed -i "s|__HISTORY_HOST__|${HISTORY_HOST:-}|g" /tmp/nginx.conf
  sed -i "s/__EDGE_REDIS_HOST__/$EDGE_REDIS_HOST/g" /tmp/nginx.conf
  sed -i "s/__EDGE_REDIS_PORT__/$EDGE_REDIS_PORT/g" /tmp/nginx.conf
  sed -i "s|__SESSION_SECRET__|$SESSION_SECRET|g" /tmp/nginx.conf

  DOCKER_NETWORK_CIDR=$(ip route | awk '/src/ {print $1}')
  sed -i "s|__DOCKER_NETWORK_CIDR__|$DOCKER_NETWORK_CIDR|g" /tmp/nginx.conf

  if [ "$DOCKERIZED_APP" = true ]; then
    sed -i "s|__BACKEND_HOST__|backend|g" /tmp/nginx.conf
    sed -i "s|__UI_HOST__|ui|g" /tmp/nginx.conf
  else
    sed -i "s|__BACKEND_HOST__|$HOST_IP|g" /tmp/nginx.conf
    sed -i "s|__UI_HOST__|$HOST_IP|g" /tmp/nginx.conf
  fi

  # Strip trailing slash from NODE_URL so `__NODE_URL__/rpc` is well-formed
  NODE_URL_STRIPPED="${NODE_URL%/}"
  sed -i "s|__NODE_URL__|$NODE_URL_STRIPPED|g" /tmp/nginx.conf

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
  cp /tmp/csrf.lua /usr/local/openresty/nginx/lua/csrf.lua
  cp /tmp/tracing.lua /usr/local/openresty/nginx/lua/tracing.lua

  if [ "$ssl" = true ] ; then
    cp -r /tmp/ssl/server.pem /etc/ssl/certs/server.pem
    cp -r /tmp/ssl/server.key /etc/ssl/private/server.key
  fi
fi

echo  'nginx is now running. See the logs below...'
exec openresty -g "daemon off;"
