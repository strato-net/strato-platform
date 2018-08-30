#!/bin/bash

set -e

MIN_TIMEOUT_BLOCKCHAIN_ENDPOINTS=60
BLOCK_TIME_MULTIPLIER_FOR_TIMEOUT=10
authBasic=${authBasic:-false}
blockTime=${blockTime:-13} # keep default the same as strato
NODE_HOST=${NODE_HOST}
ssl=${ssl:-false}
sslCertFileType=${sslCertFileType:-crt}
OAUTH_ENABLED=${OAUTH_ENABLED:-false}
OAUTH_DISCOVERY_URL=${OAUTH_DISCOVERY_URL:-NULL}
OAUTH_CLIENT_ID=${OAUTH_CLIENT_ID:-NULL}
OAUTH_CLIENT_SECRET=${OAUTH_CLIENT_SECRET:-NULL}
OAUTH_JWT_VALIDATION_ENABLED=${OAUTH_JWT_VALIDATION_ENABLED:-false}
OAUTH_JWT_VALIDATION_DISCOVERY_URL=${OAUTH_JWT_VALIDATION_DISCOVERY_URL}

# If container is running for the first time - generate config:
if [ ! -f /usr/local/openresty/nginx/conf/nginx.conf ]; then
  ########
  ### Check the validity of variables combination
  ########

  if [ ${OAUTH_ENABLED} = true ]; then
    if [[ ${SMD_MODE,,} = public ]] ; then
      echo 'OAuth cannot be used with SMD_MODE=public'
      exit 4
    fi

    if [[ ${OAUTH_DISCOVERY_URL} = NULL || ${OAUTH_CLIENT_ID} = NULL || ${OAUTH_CLIENT_SECRET} = NULL ]] ; then
      echo 'OAUTH_DISCOVERY_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET are required for OAuth. Exiting'
      exit 5
    fi

    if ! curl --silent --output /dev/null --fail --location ${OAUTH_DISCOVERY_URL}
    then
      echo "OAuth OpenID Connect Discovery URL is unreachable: ${OAUTH_DISCOVERY_URL}. Exiting."
      exit 6
    fi
  fi

  if [ ${OAUTH_JWT_VALIDATION_ENABLED} = true ]; then
    if [[ ${SMD_MODE,,} = public ]] ; then
      echo 'OAuth JWT Validation cannot be used with SMD_MODE=public'
      exit 7
    fi

    if [[ ${OAUTH_JWT_VALIDATION_DISCOVERY_URL} = NULL ]] ; then
      echo 'OAUTH_JWT_VALIDATION_DISCOVERY_URL is required for OAuth JWT Validation. Exiting'
      exit 8
    fi

    if ! curl --silent --output /dev/null --fail --location ${OAUTH_JWT_VALIDATION_DISCOVERY_URL}
    then
      echo "OAuth JWT Validation OpenID Connect Discovery URL is unreachable: ${OAUTH_JWT_VALIDATION_DISCOVERY_URL}. Exiting."
      exit 9
    fi
  fi

  ########
  ### Generate nginx.conf from template according to configuration provided
  ########
  cp /tmp/nginx.tpl.conf /tmp/nginx.conf

  # Remove OAuth configuration lines if deployment is not OAuth-enabled
  if [ "$OAUTH_ENABLED" != true ] && [ "$OAUTH_JWT_VALIDATION_ENABLED" != true ]; then
    sed -i '/#TEMPLATE_MARK_OAUTH/d' /tmp/nginx.conf
  else
    sed -i '/#TEMPLATE_MARK_NO_OAUTH/d' /tmp/nginx.conf
  fi

  if [ "$OAUTH_ENABLED" != true ]; then
    sed -i '/#TEMPLATE_MARK_OAUTH_STRATO/d' /tmp/nginx.conf
  fi

  if [ "$OAUTH_JWT_VALIDATION_ENABLED" != true ]; then
    sed -i '/#TEMPLATE_MARK_OAUTH_JWT/d' /tmp/nginx.conf
  fi

  # Remove SSL lines if deployment is not SSL-enabled
  # Set SSL cert file type if SSL-enabled
  if [ "$ssl" != true ]; then
    sed -i '/#TEMPLATE_MARK_SSL/d' /tmp/nginx.conf
  else
    sed -i 's/<SSL_CERT_FILE_TYPE>/'"$sslCertFileType"'/g' /tmp/nginx.conf
  fi

  # Remove tracking lines if running in mode 1
  if [ "$STRATO_GS_MODE" = 1 ] ; then
    sed -i '/#TEMPLATE_MARK_TRACK/d' /tmp/nginx.conf
  fi

  if [ "$blockstanbul" != true ]; then
    sed -i '/#TEMPLATE_MARK_BLOCKSTANBUL/d' /tmp/nginx.conf
  fi

  # Set the Bloc API timeout
  BLOC_TIMEOUT=$((blockTime * BLOCK_TIME_MULTIPLIER_FOR_TIMEOUT))
  if [ ${BLOC_TIMEOUT} -lt ${MIN_TIMEOUT_BLOCKCHAIN_ENDPOINTS} ]
  then
    BLOC_TIMEOUT=${MIN_TIMEOUT_BLOCKCHAIN_ENDPOINTS}
  fi
  sed -i 's/<BLOC_TIMEOUT>/'"$BLOC_TIMEOUT"'/g' /tmp/nginx.conf

  # Remove auth_basic line if deployment is not authBasic-enabled
  if [ "$authBasic" != true ] ; then
    sed -i '/auth_basic/d' /tmp/nginx.conf
  fi

  ########
  ### Generate .lua scripts from templates according to configuration provided
  ########
  if [ "$OAUTH_ENABLED" = true ] ; then
    cp /tmp/openid-auth.tpl.lua /tmp/openid-auth.lua
    sed -i 's*<OAUTH_DISCOVERY_URL>*'"$OAUTH_DISCOVERY_URL"'*g' /tmp/openid-auth.lua
    sed -i 's*<CLIENT_ID_PLACEHOLDER>*'"$OAUTH_CLIENT_ID"'*g' /tmp/openid-auth.lua
    sed -i 's*<CLIENT_SECRET_PLACEHOLDER>*'"$OAUTH_CLIENT_SECRET"'*g' /tmp/openid-auth.lua

    if [ "$ssl" = true ] ; then
      sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/yes/g' /tmp/openid-auth.lua   
      sed -i 's/<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>/https/g' /tmp/openid-auth.lua   
    else
      sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/no/g' /tmp/openid-auth.lua   
      sed -i 's/<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>/http/g' /tmp/openid-auth.lua
    fi
  fi

  if [ "$OAUTH_JWT_VALIDATION_ENABLED" = true ] ; then
    cp /tmp/openid-auth-jwt.tpl.lua /tmp/openid-auth-jwt.lua
    sed -i 's*<OAUTH_JWT_VALIDATION_DISCOVERY_URL>*'"$OAUTH_JWT_VALIDATION_DISCOVERY_URL"'*g' /tmp/openid-auth-jwt.lua
    sed -i 's*<NODE_HOST>*'"$NODE_HOST"'*g' /tmp/openid-auth-jwt.lua

    if [ "$ssl" = true ] ; then
      sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/yes/g' /tmp/openid-auth-jwt.lua
      sed -i 's/<NODE_HOST_PROTOCOL>/https/g' /tmp/openid-auth-jwt.lua
    else
      sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/no/g' /tmp/openid-auth-jwt.lua
      sed -i 's/<NODE_HOST_PROTOCOL>/http/g' /tmp/openid-auth-jwt.lua
    fi
  fi

  ########
  ### Move generated files to nginx dirs
  ########
  mv /tmp/nginx.conf /usr/local/openresty/nginx/conf/nginx.conf

  if [ "$OAUTH_ENABLED" = true ]; then
    mv /tmp/openid-auth.lua /usr/local/openresty/nginx/lua/openid-auth.lua
  fi

  if [ "$OAUTH_JWT_VALIDATION_ENABLED" = true ]; then
    mv /tmp/openid-auth-jwt.lua /usr/local/openresty/nginx/lua/openid-auth-jwt.lua
  fi

  if [ "$ssl" = true ] ; then
    cp -r /tmp/ssl/* /etc/ssl/
  fi

  if [ "$authBasic" = true ] ; then
    if [ -z "$uiPassword" ]
    then
      echo "Using the default password for user \"admin\""
      cp /tmp/auth.htpasswd /usr/local/openresty/nginx/conf/auth.htpasswd
    else
      echo "Setting UI password for user \"admin\""
      htpasswd -cb /usr/local/openresty/nginx/conf/auth.htpasswd admin ${uiPassword}
    fi
  fi
fi

echo 'Waiting for apex to be available...'
until curl --silent --output /dev/null --fail --location http://apex:3001/_ping
do
  sleep 0.5
done
echo 'apex is available'

echo 'Waiting for vault-wrapper to be available...'
until curl --silent --output /dev/null --fail --location http://vault-wrapper:8000/strato/v2.3/_ping
do
  sleep 0.5
done
echo 'vault-wrapper is available'

openresty
echo  'nginx is now running. See the logs below...'
tail -n0 -F /usr/local/openresty/nginx/logs/*.log
