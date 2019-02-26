#!/bin/bash

set -e

MIN_TIMEOUT_BLOCKCHAIN_ENDPOINTS=60
BLOCK_TIME_MULTIPLIER_FOR_TIMEOUT=10
authBasic=${authBasic:-false}
blockTime=${blockTime:-13} # keep default the same as strato
#NODE_HOST=${NODE_HOST}
ssl=${ssl:-false}
sslCertFileType=${sslCertFileType:-crt}
OAUTH_ENABLED=${OAUTH_ENABLED:-false}
OAUTH_DISCOVERY_URL=${OAUTH_DISCOVERY_URL:-NULL}
OAUTH_CLIENT_ID=${OAUTH_CLIENT_ID:-NULL}
OAUTH_CLIENT_SECRET=${OAUTH_CLIENT_SECRET:-NULL}
OAUTH_JWT_USERNAME_PROPERTY=${OAUTH_JWT_USERNAME_PROPERTY:-email}
OAUTH_STRATO42_FALLBACK=${OAUTH_STRATO42_FALLBACK:-false}

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

    if [ ${OAUTH_STRATO42_FALLBACK} = true ]; then
      if [[ ${OAUTH_DISCOVERY_URL} = NULL ]] ; then
        echo 'OAUTH_DISCOVERY_URL is required for OAuth in OAUTH_STRATO42_FALLBACK mode. Exit'
        exit 7
      fi
    else
      if [[ ${OAUTH_DISCOVERY_URL} = NULL || ${OAUTH_CLIENT_ID} = NULL || ${OAUTH_CLIENT_SECRET} = NULL ]] ; then
        echo 'OAUTH_DISCOVERY_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET are required for OAuth. Exit'
        exit 5
      fi
    fi

    if ! curl --silent --output /dev/null --fail --location ${OAUTH_DISCOVERY_URL}
    then
      echo "OAuth OpenID Connect Discovery URL is unreachable: ${OAUTH_DISCOVERY_URL}. Exit"
      exit 6
    fi
  fi

  ########
  ### Generate nginx.conf from template according to configuration provided
  ########
  cp /tmp/nginx.tpl.conf /tmp/nginx.conf

  # Remove OAuth configuration lines if deployment is not OAuth-enabled
  if [ "$OAUTH_ENABLED" != true ]; then
    sed -i '/#TEMPLATE_MARK_OAUTH/d' /tmp/nginx.conf
  else
    sed -i '/#TEMPLATE_MARK_NO_OAUTH/d' /tmp/nginx.conf
  fi

  if [ "$OAUTH_ENABLED" != true ]; then
    sed -i '/#TEMPLATE_MARK_OAUTH_LOGIN/d' /tmp/nginx.conf
    sed -i '/#TEMPLATE_MARK_OAUTH_VERIFY/d' /tmp/nginx.conf
  fi
  
  if [ "$OAUTH_STRATO42_FALLBACK" = true ]; then
    sed -i '/#TEMPLATE_MARK_OAUTH_STRATO_43_AND_ABOVE/d' /tmp/nginx.conf
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

  if [ "$SERVE_LOGS" != true ]; then
    sed -i '/#TEMPLATE_MARK_LOGS/d' /tmp/nginx.conf
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
    cp /tmp/openid-login.tpl.lua /tmp/openid-login.lua
    cp /tmp/openid-verify.tpl.lua /tmp/openid-verify.lua
    # Login lua file
    sed -i 's*<OAUTH_JWT_USERNAME_PROPERTY>*'"$OAUTH_JWT_USERNAME_PROPERTY"'*g' /tmp/openid-login.lua
    sed -i 's*<OAUTH_DISCOVERY_URL>*'"$OAUTH_DISCOVERY_URL"'*g' /tmp/openid-login.lua
    sed -i 's*<CLIENT_ID_PLACEHOLDER>*'"$OAUTH_CLIENT_ID"'*g' /tmp/openid-login.lua
    sed -i 's*<CLIENT_SECRET_PLACEHOLDER>*'"$OAUTH_CLIENT_SECRET"'*g' /tmp/openid-login.lua
    # Verify lua file
    sed -i 's*<OAUTH_JWT_USERNAME_PROPERTY>*'"$OAUTH_JWT_USERNAME_PROPERTY"'*g' /tmp/openid-verify.lua
    sed -i 's*<OAUTH_DISCOVERY_URL>*'"$OAUTH_DISCOVERY_URL"'*g' /tmp/openid-verify.lua
    #sed -i 's*<NODE_HOST>*'"$NODE_HOST"'*g' /tmp/openid-verify.lua

    if [ "$ssl" = true ] ; then
      # Login lua file
      sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/yes/g' /tmp/openid-login.lua
      sed -i 's/<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>/https/g' /tmp/openid-login.lua
      # Verify lua file
      sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/yes/g' /tmp/openid-verify.lua
      #sed -i 's/<NODE_HOST_PROTOCOL>/https/g' /tmp/openid-verify.lua
    else
      # Login lua file
      sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/no/g' /tmp/openid-login.lua
      sed -i 's/<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>/http/g' /tmp/openid-login.lua
      # Verify lua file
      sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/no/g' /tmp/openid-verify.lua
      #sed -i 's/<NODE_HOST_PROTOCOL>/http/g' /tmp/openid-verify.lua
    fi
  fi

  ########
  ### Move generated files to nginx dirs
  ########
  mv /tmp/nginx.conf /usr/local/openresty/nginx/conf/nginx.conf

  if [ "$OAUTH_ENABLED" = true ]; then
    mv /tmp/openid-login.lua /usr/local/openresty/nginx/lua/openid-login.lua
    mv /tmp/openid-verify.lua /usr/local/openresty/nginx/lua/openid-verify.lua
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
