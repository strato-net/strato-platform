#!/bin/bash

set -x
set -e

MIN_TIMEOUT_BLOCKCHAIN_ENDPOINTS=60
BLOCK_TIME_MULTIPLIER_FOR_TIMEOUT=10
authBasic=${authBasic:-false}
blockTime=${blockTime:-13} # keep default the same as strato
ssl=${ssl:-false}
sslCertFileType=${sslCertFileType:-crt}
azureAD=${azureAD:-false}
azureADTenantID=${azureADTenantID:-NULL}
azureADClientID=${azureADClientID:-NULL}
azureADClientSecret=${azureADClientSecret:-NULL}

# If container is running for the first time - generate config:
if [ ! -f /usr/local/openresty/nginx/conf/nginx.conf ]; then
  ########
  ### Check the validity of variables combination
  ########
  if [ "$azureAD" = true ]; then
    if [[ ${SMD_MODE,,} = public ]] ; then
     echo 'Azure AD cannot be used with SMD_MODE=public'
     exit 4
    fi

    if [[ $azureADTenantID = NULL || $azureADClientID = NULL || $azureADClientSecret = NULL ]] ; then
      echo 'AzureAD TenantID / ClientID / ClientSecret are required for azureAD'
      exit 4
    fi
  fi

  ########
  ### Generate nginx.conf from template according to configuration provided
  ########
  cp /tmp/nginx.tpl.conf /tmp/nginx.conf

  # Remove Azure Active Directory configuration lines if deployment is not AAD-enabled
  if [ "$azureAD" != true ]; then
    sed -i '/#TEMPLATE_MARK_AZUREAD/d' /tmp/nginx.conf
  else
    sed -i '/#TEMPLATE_MARK_NO_AZUREAD/d' /tmp/nginx.conf
    # Required with lua_code_cache off
    #sed -i 's/<SESSION_SECRET>/mySessionSecretKeyHash/g' /tmp/nginx.conf
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
  ### Generate azure-authentication.lua from template according to configuration provided
  ########
  if [ "$azureAD" = true ] ; then
    cp /tmp/azure-authentication.tpl.lua /tmp/azure-authentication.lua

    sed -i 's/<TENANT_ID_PLACEHOLDER>/'"$azureADTenantID"'/g' /tmp/azure-authentication.lua
    sed -i 's/<CLIENT_ID_PLACEHOLDER>/'"$azureADClientID"'/g' /tmp/azure-authentication.lua
    sed -i 's/<CLIENT_SECRET_PLACEHOLDER>/'"$azureADClientSecret"'/g' /tmp/azure-authentication.lua

    if [ "$ssl" = true ] ; then
      sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/yes/g' /tmp/azure-authentication.lua
      sed -i 's/<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>/https/g' /tmp/azure-authentication.lua
    else
      sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/no/g' /tmp/azure-authentication.lua
      sed -i 's/<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>/http/g' /tmp/azure-authentication.lua
    fi
  fi

  ########
  ### Move generated files to nginx dirs
  ########
  mv /tmp/nginx.conf /usr/local/openresty/nginx/conf/nginx.conf

  if [ "$azureAD" = true ]; then
    mv /tmp/azure-authentication.lua /usr/local/openresty/nginx/lua/azure-authentication.lua
    # fetch libraries from repo:
    opm get zmartzone/lua-resty-openidc
    opm get SkyLothar/lua-resty-jwt
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

echo 'Waiting for oauth to be available...'
until curl --silent --output /dev/null --fail --location http://oauth:8000/_ping
do
  sleep 0.5
done
echo 'oauth is available'

openresty
tail -n0 -F /usr/local/openresty/nginx/logs/*.log
