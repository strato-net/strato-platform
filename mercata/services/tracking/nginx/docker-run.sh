#!/bin/bash

set -e

ssl=${ssl:-true}
sslCertFileType=${sslCertFileType:-pem}
TRACKING_HOST=${TRACKING_HOST:-tracking:3010}
APP_ORIGIN=${TRACKING_APP_ORIGIN:-https://app.strato.nexus}

# If container is running for the first time - generate config:
if [ ! -f /usr/local/openresty/nginx/conf/nginx.conf ]; then

  ########
  ### Generate nginx.conf from template according to configuration provided
  ########
  cp /tmp/nginx.tpl.conf /tmp/nginx.conf
  if [ "$ssl" != true ]; then
    sed -i '/#TEMPLATE_MARK_SSL/d' /tmp/nginx.conf
  else
    sed -i 's/<SSL_CERT_FILE_TYPE>/'"$sslCertFileType"'/g' /tmp/nginx.conf
  fi
  sed -i "s|__TRACKING_HOST__|$TRACKING_HOST|g" /tmp/nginx.conf
  sed -i "s|__APP_ORIGIN__|$APP_ORIGIN|g" /tmp/nginx.conf

  mv /tmp/nginx.conf /usr/local/openresty/nginx/conf/nginx.conf

  if [ "$ssl" = true ] ; then
    cp -r /tmp/ssl/* /etc/ssl/
  fi
fi

echo 'nginx is now running. See the logs below...'
exec openresty -g "daemon off;"
