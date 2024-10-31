#!/bin/bash

set -e

MIN_TIMEOUT_BLOCKCHAIN_ENDPOINTS=60
BLOCK_TIME_MULTIPLIER_FOR_TIMEOUT=10
blockTime=${blockTime:-13} # keep default the same as strato
ssl=${ssl:-false}
sslCertFileType=${sslCertFileType:-pem}
OAUTH_CLIENT_ID=${OAUTH_CLIENT_ID:-NULL}
OAUTH_CLIENT_SECRET=${OAUTH_CLIENT_SECRET:-NULL}
OAUTH_SCOPE=${OAUTH_SCOPE:-openid email profile}
VM_DEBUG=${VM_DEBUGGER:-false}
debugPort=${debugPort:-8051}
debugWSHost=${debugWSHost:-strato}
debugWSPort=${debugWSPort:-8052}
STATS_ENABLED=${STATS_ENABLED:-true}
SMD_DEV_MODE=${SMD_DEV_MODE:-false}
SMD_DEV_MODE_HOST_IP=${SMD_DEV_MODE_HOST_IP:-172.17.0.1}
APEX_HOST=${APEX_HOST:-apex:3009}
DOCS_HOST=${DOCS_HOST:-docs:8080}
MARKETPLACE_BACKEND_HOST=${MARKETPLACE_BACKEND_HOST:-marketplace-backend:3030}
MARKETPLACE_UI_HOST=${MARKETPLACE_UI_HOST:-marketplace-ui:3003}
POSTGREST_HOST=${POSTGREST_HOST:-postgrest:3001}
PROMETHEUS_HOST=${PROMETHEUS_HOST:-prometheus:9090}
SMD_HOST=${SMD_HOST:-smd:3002}
STRATO_HOSTNAME=${STRATO_HOSTNAME:-strato}
STRATO_PORT_API=${STRATO_PORT_API:-3000}
STRATO_PORT_API2=${STRATO_PORT_API2:-3001}
STRATO_PORT_LOGS=${STRATO_PORT_LOGS:-7065}
STRATO_PORT_VAULT_PROXY=${STRATO_PORT_VAULT_PROXY:-8013}

# If container is running for the first time - generate config:
if [ ! -f /usr/local/openresty/nginx/conf/nginx.conf ]; then
  ########
  ### Check the validity of variables combination
  ########
  if [[ ${OAUTH_CLIENT_ID} = NULL || ${OAUTH_CLIENT_SECRET} = NULL ]] ; then
    echo 'OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET are required for OAuth. Exit'
    exit 4
  fi
  # get oauth discovery url from strato api
  echo "Waiting for Strato api to be available..."
  ETH_ENDPOINT=http://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2
  until curl --silent --output /dev/null --fail --location ${ETH_ENDPOINT}/stats/totaltx
  do
    echo "  Check at $(date)"
    sleep 1
  done
  echo "Strato api is available"
  OAUTH_DISCOVERY_URL=$(curl --silent --fail ${ETH_ENDPOINT}/metadata | jq -r .urls.oauthDiscovery)
  if [ -z "${OAUTH_DISCOVERY_URL}" ]; then
    echo "Could not get OAuth discovery url from strato api, but it is a required value"
    exit 5
  fi
  if ! curl --silent --output /dev/null --fail --location ${OAUTH_DISCOVERY_URL}
  then
    echo "OAuth OpenID Connect Discovery URL is unreachable: ${OAUTH_DISCOVERY_URL}. Exit"
    exit 6
  fi

  ########
  ### Generate nginx.conf from template according to configuration provided
  ########
  cp /tmp/nginx.tpl.conf /tmp/nginx.conf

  if [ "$VM_DEBUG" != true ]; then
    sed -i '/#TEMPLATE_MARK_DEBUG/d' /tmp/nginx.conf
  fi
  sed -i 's/<DEBUG_PORT_PLACEHOLDER>/'"$debugPort"'/g' /tmp/nginx.conf
  sed -i 's/<WS_DEBUG_PORT_PLACEHOLDER>/'"$debugWSPort"'/g' /tmp/nginx.conf

  # This is used to remove lines from the nginx.conf
  # without having to put the entire replacement string in this file
  if [ "$SMD_DEV_MODE" != true ]; then
    sed -i '/#TEMPLATE_SMD_DEV_MODE/d' /tmp/nginx.conf

  else
    sed -i '/#TEMPLATE_SMD_PROD_MODE/d' /tmp/nginx.conf
    sed -i 's/<SMD_DEV_MODE_HOST_IP>/'"$SMD_DEV_MODE_HOST_IP"'/g' /tmp/nginx.conf
  fi
  # Remove SSL lines if deployment is not SSL-enabled
  # Set SSL cert file type if SSL-enabled
  if [ "$ssl" != true ]; then
    sed -i '/#TEMPLATE_MARK_SSL/d' /tmp/nginx.conf
  else
    sed -i 's/<SSL_CERT_FILE_TYPE>/'"$sslCertFileType"'/g' /tmp/nginx.conf
  fi

  # Remove Stats lines if running in STATS_ENABLED=false
  if [ "$STATS_ENABLED" != true ] ; then
    sed -i '/#TEMPLATE_MARK_STATS_ENABLED/d' /tmp/nginx.conf
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

  # Replacing HOST NAME PLACEHOLDERS
  sed -i "s/__APEX_HOST__/$APEX_HOST/g" /tmp/nginx.conf
  sed -i "s/__DOCS_HOST__/$DOCS_HOST/g" /tmp/nginx.conf
  sed -i "s/__MARKETPLACE_BACKEND_HOST__/$MARKETPLACE_BACKEND_HOST/g" /tmp/nginx.conf
  sed -i "s/__MARKETPLACE_UI_HOST__/$MARKETPLACE_UI_HOST/g" /tmp/nginx.conf
  sed -i "s/__POSTGREST_HOST__/$POSTGREST_HOST/g" /tmp/nginx.conf
  sed -i "s/__PROMETHEUS_HOST__/$PROMETHEUS_HOST/g" /tmp/nginx.conf
  sed -i "s/__SMD_HOST__/$SMD_HOST/g" /tmp/nginx.conf
  sed -i "s/__STRATO_HOSTNAME__/$STRATO_HOSTNAME/g" /tmp/nginx.conf
  sed -i "s/__STRATO_PORT_API__/$STRATO_PORT_API/g" /tmp/nginx.conf
  sed -i "s/__STRATO_PORT_API2__/$STRATO_PORT_API2/g" /tmp/nginx.conf
  sed -i "s/__STRATO_PORT_LOGS__/$STRATO_PORT_LOGS/g" /tmp/nginx.conf
  sed -i "s/__STRATO_PORT_VAULT_PROXY__/$STRATO_PORT_VAULT_PROXY/g" /tmp/nginx.conf

  ########
  ### Generate .lua scripts from templates according to configuration provided
  ########
  cp /tmp/openid.tpl.lua /tmp/openid.lua
  sed -i 's*<OAUTH_DISCOVERY_URL_PLACEHOLDER>*'"$OAUTH_DISCOVERY_URL"'*g' /tmp/openid.lua
  sed -i 's*<CLIENT_ID_PLACEHOLDER>*'"$OAUTH_CLIENT_ID"'*g' /tmp/openid.lua
  sed -i 's*<CLIENT_SECRET_PLACEHOLDER>*'"$OAUTH_CLIENT_SECRET"'*g' /tmp/openid.lua
  sed -i 's*<OAUTH_SCOPE_PLACEHOLDER>*'"$OAUTH_SCOPE"'*g' /tmp/openid.lua

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

echo 'Waiting for apex to be available...'
until curl --silent --output /dev/null --fail --location http://${APEX_HOST}/_ping
do
  sleep 0.5
done
echo 'apex is available'

echo 'Waiting for VaultProxy to be available with node key added to Vault...'
until curl --silent --output /dev/null --fail --location http://${STRATO_HOSTNAME}:${STRATO_PORT_VAULT_PROXY}/strato/v2.3/key
do
  sleep 0.5
done
echo 'VaultProxy is available'

echo  'nginx is now running. See the logs below...'
openresty -g "daemon off;"
