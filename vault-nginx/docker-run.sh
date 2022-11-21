#!/bin/bash

set -e

ssl=${ssl:-false}
sslCertFileType=${sslCertFileType:-crt}
INITIAL_OAUTH_DISCOVERY_URL=${INITIAL_OAUTH_DISCOVERY_URL:-NULL}
INITIAL_OAUTH_ISSUER=${INITIAL_OAUTH_ISSUER:-NULL}
INITIAL_OAUTH_JWT_USERNAME_PROPERTY=${INITIAL_OAUTH_JWT_USERNAME_PROPERTY:-sub}
VAULT_WRAPPER_HOST=${VAULT_WRAPPER_HOST:-vault-wrapper:8000}

# If container is running for the first time - generate config:
if [ ! -f /usr/local/openresty/nginx/conf/nginx.conf ]; then
  ########
  ### Check the validity of variables combination
  ########
  # TODO: need to check all INITIAL_values but may be skipped if config file not empty
  if [[ ${INITIAL_OAUTH_DISCOVERY_URL} = NULL ]] ; then
    echo 'INITIAL_OAUTH_DISCOVERY_URL is a required env var. Exit'
    exit 5
  fi
  if ! curl --silent --output /dev/null --fail --location "${INITIAL_OAUTH_DISCOVERY_URL}"
  then
    echo "OAuth OpenID Connect Discovery URL is unreachable: ${INITIAL_OAUTH_DISCOVERY_URL}. Exit"
    exit 6
  fi

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
  sed -i 's/__VAULT_WRAPPER_HOST__/'"$VAULT_WRAPPER_HOST"'/g' /tmp/nginx.conf

  ########
  ### Generate .lua scripts from templates according to configuration provided
  ########
  cp /tmp/openid.tpl.lua /tmp/openid.lua
  # TODO: oauth data is in files
  sed -i 's*<INITIAL_OAUTH_JWT_USERNAME_PROPERTY_PLACEHOLDER>*'"$INITIAL_OAUTH_JWT_USERNAME_PROPERTY"'*g' /tmp/openid.lua
  sed -i 's*<INITIAL_OAUTH_DISCOVERY_URL_PLACEHOLDER>*'"$INITIAL_OAUTH_DISCOVERY_URL"'*g' /tmp/openid.lua
  sed -i 's*<INITIAL_OAUTH_ISSUER_PLACEHOLDER>*'"$INITIAL_OAUTH_ISSUER"'*g' /tmp/openid.lua

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

echo 'Waiting for Vault-Wrapper to be available...'
until curl --silent --output /dev/null --fail --location "http://${VAULT_WRAPPER_HOST}/strato/v2.3/_ping"
do
  sleep 0.5
done
echo 'Vault-Wrapper is available'

echo  'nginx is now running. See the logs below...'
openresty -g "daemon off;"
