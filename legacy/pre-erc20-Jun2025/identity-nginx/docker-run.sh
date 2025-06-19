#!/bin/bash

set -e

ssl=${ssl:-false}
sslCertFileType=${sslCertFileType:-pem}
# OAUTH_DISCOVERY_URL=${OAUTH_DISCOVERY_URL:-NULL}
# OAUTH_CLIENT_ID=${OAUTH_CLIENT_ID:-NULL}
# OAUTH_CLIENT_SECRET=${OAUTH_CLIENT_SECRET:-NULL}
# OAUTH_SCOPE=${OAUTH_SCOPE:-openid email profile}
IDENTITY_PROVIDER_HOSTNAME=${IDENTITY_PROVIDER_HOSTNAME:-identity-provider}
IDENTITY_PORT=${IDENTITY_PORT:-8014}
IDENTITY_PORT_VAULT_PROXY=${IDENTITY_PORT_VAULT_PROXY:-8013}

# If container is running for the first time - generate config:
if [ ! -f /usr/local/openresty/nginx/conf/nginx.conf ]; then
  python3 createRealmConfig.py #TODO: error handling?

  ########
  ### Generate nginx.conf from template according to configuration provided
  ########
  cp /tmp/nginx.tpl.conf /tmp/nginx.conf

  # Remove SSL lines if deployment is not SSL-enabled
  # Set SSL cert file type if SSL-enabled
  if [ "$ssl" != true ]; then
    sed -i '/#TEMPLATE_MARK_SSL/d' /tmp/nginx.conf
  else
    sed -i 's/<SSL_CERT_FILE_TYPE>/'"$sslCertFileType"'/g' /tmp/nginx.conf
  fi

  if [ "$SERVE_LOGS" != true ]; then
    sed -i '/#TEMPLATE_MARK_LOGS/d' /tmp/nginx.conf
  fi

  # Replacing HOST NAME PLACEHOLDERS
  sed -i "s/__IDENTITY_PROVIDER_HOSTNAME__/$IDENTITY_PROVIDER_HOSTNAME/g" /tmp/nginx.conf
  sed -i "s/__IDENTITY_PORT__/$IDENTITY_PORT/g" /tmp/nginx.conf
  sed -i "s/__IDENTITY_PORT_VAULT_PROXY__/$IDENTITY_PORT_VAULT_PROXY/g" /tmp/nginx.conf

  ########
  ### Generate .lua scripts from templates according to configuration provided
  ########
  cp /tmp/openid.tpl.lua /tmp/openid.lua

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
    cp -r /tmp/ssl/* /etc/ssl/
  fi
fi

echo  'nginx is now running. See the logs below...'
openresty -g "daemon off;"