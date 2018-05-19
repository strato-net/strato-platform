#!/bin/bash

set -x
set -e

MIN_TIMEOUT_BLOCKCHAIN_ENDPOINTS=60
BLOCK_TIME_MULTIPLIER_FOR_TIMEOUT=10
authBasic=${authBasic:-false}
blockTime=${blockTime:-13} # keep default the same as strato
sslCertFileType=${sslCertFileType:-crt}
azureAD=${azureAD:-false}
azureADTenantID=${azureADTenantID:-NULL}
azureADClientID=${azureADClientID:-NULL}
azureADClientSecret=${azureADClientSecret:-NULL}

if [[ $azureAD = true && ${SMD_MODE,,} = public ]] ; then
 echo 'Azure AD cannot be used with SMD_MODE=public'
 exit 4
fi

if [ "$azureAD" = true ]; then CONF_FILENAME_PREFIX=azure-nginx-; else CONF_FILENAME_PREFIX=nginx-; fi
cp /tmp/${CONF_FILENAME_PREFIX}$(${ssl:-false} || echo "no")ssl.conf /usr/local/openresty/nginx/conf/nginx.conf

if [ "$ssl" = true ] ; then
	cp -r /tmp/ssl/* /etc/ssl/
	sed -i 's/<SSL_CERT_FILE_TYPE>/'"$sslCertFileType"'/g' /usr/local/openresty/nginx/conf/nginx.conf
fi

BLOC_TIMEOUT=$((blockTime * BLOCK_TIME_MULTIPLIER_FOR_TIMEOUT))
if [ ${BLOC_TIMEOUT} -lt ${MIN_TIMEOUT_BLOCKCHAIN_ENDPOINTS} ]
then
  BLOC_TIMEOUT=${MIN_TIMEOUT_BLOCKCHAIN_ENDPOINTS}
fi

sed -i 's/<BLOC_TIMEOUT>/'"$BLOC_TIMEOUT"'/g' /usr/local/openresty/nginx/conf/nginx.conf

if [ "$authBasic" != true ] ; then
	sed -i '/auth_basic/d' /usr/local/openresty/nginx/conf/nginx.conf
else
 cp /tmp/auth.htpasswd /usr/local/openresty/nginx/conf/auth.htpasswd
 if [ -z "$uiPassword" ]
 then
   echo "Using the default password for user \"admin\""
 else
   echo "Setting UI password for user \"admin\""
   htpasswd -cb /usr/local/openresty/nginx/conf/auth.htpasswd admin ${uiPassword}
 fi
fi

if [ "$STRATO_GS_MODE" = 1 ] ; then
	sed -i '/_track/d' /usr/local/openresty/nginx/conf/nginx.conf
fi

# TODOs
# merge the regular and azure configs and clean with sed when in public mode //nik
# check if nothing is overwritten on container restart (nginx.conf and random session-secret in it)
# add the flag (file) showing that container was run before and check for this script

if [ "$azureAD" = true ] ; then

 if [[ $azureADTenantID = NULL || $azureADClientID = NULL || $azureADClientSecret = NULL ]] ; then
  echo 'AzureAD TenantID / ClientID / ClientSecret is required'
  exit 4
 fi

 cp /tmp/azure-authentication.lua /usr/local/openresty/nginx/lua/azure-authentication.lua
 opm get zmartzone/lua-resty-openidc
 opm get SkyLothar/lua-resty-jwt

 # Required with lua_code_cache off
 #sed -i 's/<SESSION_SECRET>/623q4hR325t36VsCD3g567922IC@!QnAoZXpbVc3Oz/g' /usr/local/openresty/nginx/conf/nginx.conf

 sed -i 's/<TENANT_ID_PLACEHOLDER>/'"$azureADTenantID"'/g' /usr/local/openresty/nginx/lua/azure-authentication.lua
 sed -i 's/<CLIENT_ID_PLACEHOLDER>/'"$azureADClientID"'/g' /usr/local/openresty/nginx/lua/azure-authentication.lua
 sed -i 's/<CLIENT_SECRET_PLACEHOLDER>/'"$azureADClientSecret"'/g' /usr/local/openresty/nginx/lua/azure-authentication.lua

 if [ "$ssl" = true ] ; then
  sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/yes/g' /usr/local/openresty/nginx/lua/azure-authentication.lua
  sed -i 's/<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>/https/g' /usr/local/openresty/nginx/lua/azure-authentication.lua
 else
  sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/no/g' /usr/local/openresty/nginx/lua/azure-authentication.lua
  sed -i 's/<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>/http/g' /usr/local/openresty/nginx/lua/azure-authentication.lua
 fi

fi

if [ "$STRATO_GS_MODE" = 1 ] ; then
	sed -i '/_track/d' /etc/nginx/nginx.conf
fi

echo 'Waiting for apex to be available...'
until curl --silent --output /dev/null --fail --location http://apex:3001/_ping
do
  sleep 0.5
done
echo 'apex is available'

openresty
tail -n0 -F /usr/local/openresty/nginx/logs/*.log