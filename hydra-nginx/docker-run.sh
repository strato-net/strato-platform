#!/bin/bash

set -e

ssl=${ssl:-false}
sslCertFileType=${sslCertFileType:-pem}
INITIAL_OAUTH_DISCOVERY_URL=${INITIAL_OAUTH_DISCOVERY_URL:-NULL}
INITIAL_OAUTH_ISSUER=${INITIAL_OAUTH_ISSUER:-NULL}
INITIAL_OAUTH_JWT_USER_ID_CLAIM=${INITIAL_OAUTH_JWT_USER_ID_CLAIM:-sub}
HYDRA_WRAPPER_HOST=${HYDRA_WRAPPER_HOST:-hydra:4444}

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

  # Replacing HOST NAME PLACEHOLDERS
  sed -i 's/__HYDRA_WRAPPER_HOST__/'"$HYDRA_WRAPPER_HOST"'/g' /tmp/nginx.conf

  ########
  ### Move generated files to nginx dirs
  ########
  mv /tmp/nginx.conf /usr/local/openresty/nginx/conf/nginx.conf

  if [ "$ssl" = true ] ; then
    cp -r /tmp/ssl/* /etc/ssl/
  fi
fi

echo  'nginx is now running. See the logs below...'
openresty -g "daemon off;"
