#!/bin/bash

set -e

ssl=${ssl:-false}
sslCertFileType=${sslCertFileType:-pem}
INITIAL_OAUTH_DISCOVERY_URL=${INITIAL_OAUTH_DISCOVERY_URL:-NULL}
INITIAL_OAUTH_ISSUER=${INITIAL_OAUTH_ISSUER:-NULL}
INITIAL_OAUTH_JWT_USER_ID_CLAIM=${INITIAL_OAUTH_JWT_USER_ID_CLAIM:-sub}
INITIAL_OAUTH_JWKS_URL=${INITIAL_OAUTH_JWKS_URL:-}
VAULT_WRAPPER_HOST=${VAULT_WRAPPER_HOST:-vault-wrapper:8000}
WAIT_FOR_VAULT_WRAPPER=${WAIT_FOR_VAULT_WRAPPER:-true}

mkdir -p /config

# If container is running for the first time - generate config:
if [ ! -f /usr/local/openresty/nginx/conf/nginx.conf ]; then
  ########
  ### Check the validity of variables combination
  ########
  if [ ! -f /config/config.json ]; then
    if [[ ${INITIAL_OAUTH_DISCOVERY_URL} = NULL || ${INITIAL_OAUTH_ISSUER} = NULL ]]; then
      echo 'INITIAL_OAUTH_DISCOVERY_URL and INITIAL_OAUTH_ISSUER are required env vars when no config file exists. Exit'
      exit 5
    fi
    if ! curl --silent --output /dev/null --fail --location "${INITIAL_OAUTH_DISCOVERY_URL}"
    then
      echo "OAuth OpenID Connect Discovery URL is unreachable: ${INITIAL_OAUTH_DISCOVERY_URL}. Exit"
      exit 6
    fi
    if [ -z "$INITIAL_OAUTH_JWKS_URL" ]; then
      INITIAL_OAUTH_JWKS_URL="${INITIAL_OAUTH_DISCOVERY_URL%openid-configuration}jwks.json"
    fi
    echo "{
  \"identity_providers\": [
    {
      \"ISSUER\": \"${INITIAL_OAUTH_ISSUER}\",
      \"DISCOVERY_URL\": \"${INITIAL_OAUTH_DISCOVERY_URL}\",
      \"JWKS_URL\": \"${INITIAL_OAUTH_JWKS_URL}\",
      \"USER_ID_CLAIM\": \"${INITIAL_OAUTH_JWT_USER_ID_CLAIM}\"
    }
  ]
}" > /config/config.json
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

if [ "$WAIT_FOR_VAULT_WRAPPER" = true ]; then
  echo 'Waiting for Vault-Wrapper to be available...'
  # /_ping returns 200 when the vault password is set and 503 when it is
  # awaiting password initialization. Either response means the upstream is
  # reachable and nginx can start proxying; any other condition (connection
  # refused, timeout, transient 5xx) keeps the loop waiting.
  until status=$(curl --silent --output /dev/null --location \
                      --write-out '%{http_code}' --max-time 2 \
                      "http://${VAULT_WRAPPER_HOST}/strato/v2.3/_ping") \
         && { [ "$status" = "200" ] || [ "$status" = "503" ]; }
  do
    sleep 0.5
  done
  echo 'Vault-Wrapper is available'
fi

echo  'nginx is now running. See the logs below...'
exec openresty -g "daemon off;"
