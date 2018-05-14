#!/bin/bash

set -x
set -e

MIN_TIMEOUT_BLOCKCHAIN_ENDPOINTS=60
BLOCK_TIME_MULTIPLIER_FOR_TIMEOUT=10
authBasic=${authBasic:-false}
blockTime=${blockTime:-13} # keep default the same as strato
sslCertFileType=${sslCertFileType:-crt}

if [ -z "$uiPassword" ]
then
  echo "Using the default password for user \"admin\""
else
  echo "Setting UI password for user \"admin\""
  htpasswd -cb /usr/local/openresty/nginx/conf/auth.htpasswd admin ${uiPassword}
fi

if [ "$SMD_MODE" = "enterpise" ]; then CONF_FILENAME_PREFIX=azure-nginx; else CONF_FILENAME_PREFIX=nginx; fi
mv /tmp/${CONF_FILENAME_PREFIX}(${ssl:-false} || echo "no")ssl.conf /usr/local/openresty/nginx/conf/nginx.conf

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
	sed -i '/auth_basic/d' /usr/local/openresty/nginx/conf/nginx/nginx.conf
fi


# TODOs
# WRONG - replace placeholder for session_secret in nginx.conf with RANDOM string (sha256sum?)
# PROPER WAY - add env var to pass the session_secret string
# pass all the hardcoded parameters below from docker-compose
# merge the regular and azure configs and clean with sed when in public mode //nik
# check if nothing is overwritten on container restart (nginx.conf and random session-secret in it)

if [ "$SMD_MODE" = "enterpise" ] ; then
 sed -i 's/<SESSION_SECRET>/623q4hR325t36VsCD3g567922IC@!QnAoZXpbVc3Oz/g' /usr/local/openresty/nginx/conf/nginx.conf
 sed -i 's/<CLIENT_ID_PLACEHOLDER>/'"bec8ad68-9e10-4c31-ab08-eac305f160c2"'/g' /usr/local/openresty/nginx/lua/azure-authentication.lua
 sed -i 's/<CLIENT_SECRET_PLACEHOLDER>/'"WBSFCpfyuFecMa9DYEZeCKRigRuZBJix1g5QisIUDKo="'/g' /usr/local/openresty/nginx/lua/azure-authentication.lua
 if [ "$ssl" = true ] ; then
  sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/'"yes"'/g' /usr/local/openresty/nginx/lua/azure-authentication.lua
  sed -i 's/<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>/'"https"'/g' /usr/local/openresty/nginx/lua/azure-authentication.lua
 else
  sed -i 's/<IS_SSL_PLACEHOLDER_YES_NO>/'"no"'/g' /usr/local/openresty/nginx/lua/azure-authentication.lua
  sed -i 's/<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>/'"http"'/g' /usr/local/openresty/nginx/lua/azure-authentication.lua
 fi

fi

echo 'Waiting for apex to be available...'
until curl --silent --output /dev/null --fail --location http://apex:3001/_ping
do
  sleep 0.5
done
echo 'apex is available'

# TODO: run openresty instead
openresty || (tail -n 5 /var/log/nginx/error.log && exit 1) # Restart container if nginx failed to start (wait for all upstreams to become available)
tail -n0 -F /var/log/nginx/*.log
