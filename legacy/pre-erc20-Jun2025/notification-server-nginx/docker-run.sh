#!/bin/bash

set -e

NOTIFICATION_SERVER_HOST='notification-server:8019'
OAUTH_DISCOVERY_URL=${OAUTH_DISCOVERY_URL:-NULL}
ssl=${ssl:-true}
sslCertFileType=${sslCertFileType:-pem}


# If container is running for the first time - generate config:
if [ ! -f /usr/local/openresty/nginx/conf/nginx.conf ]; then

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

  # Replacing HOST PLACEHOLDERS
  sed -i "s/__NOTIFICATION_SERVER_HOST__/$NOTIFICATION_SERVER_HOST/g" /tmp/nginx.conf

#  ########
#  ### Generate .lua scripts from templates according to configuration provided
#  ########
 cp /tmp/openid.tpl.lua /tmp/openid.lua

 sed -i "s*<OAUTH_DISCOVERY_URL_PLACEHOLDER>*$OAUTH_DISCOVERY_URL*" /tmp/openid.lua

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
