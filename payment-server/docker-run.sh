#!/bin/sh
set -e

export DOCKERIZED="true"

export CONFIG_DIR_PATH=/config
export SERVER_HOST=${SERVER_HOST}
export STRATO_HOST=${STRATO_HOST}
export OAUTH_DISCOVERY_URL=${OAUTH_DISCOVERY_URL}
export OAUTH_CLIENT_ID=${OAUTH_CLIENT_ID}
export OAUTH_CLIENT_SECRET=${OAUTH_CLIENT_SECRET}
export OAUTH_SCOPE=${OAUTH_SCOPE}
export OAUTH_SERVICE_OAUTH_FLOW=${OAUTH_SERVICE_OAUTH_FLOW}
export SKIP_CONTRACT_VALIDATION=${SKIP_CONTRACT_VALIDATION}

echo $OAUTH_DISCOVERY_URL

# Generating the ./config/generated.config.yaml - an intermediate step to avoid removing CONFIG var (that would break the non-docker deployment)
cp ./config/template.config.yaml /tmp/tmp.config.yaml
  
# Validate the env vars
# TODO: check if EVERY env var is provided (in the for loop - refactor)
if [ -z "${SERVER_HOST}" ]; then
  echo "SERVER_HOST is empty but is a required value"
  exit 11
fi
if [[ "${SERVER_HOST}" == *"\/" ]]; then
  echo "SERVER_HOST must not contain the trailing slash"
  exit 112
fi
  
if [ -z "${OAUTH_CLIENT_ID}" ]; then
  echo "OAUTH_CLIENT_ID is empty but is a required value"
  exit 15
fi
  
if [ -z "${OAUTH_CLIENT_SECRET}" ]; then
  echo "OAUTH_CLIENT_SECRET is empty but is a required value"
  exit 16
fi

sed -i 's*<configDirPath_value>*'"${CONFIG_DIR_PATH}"'*g' /tmp/tmp.config.yaml
sed -i 's*<serverHost_value>*'"${SERVER_HOST}"'*g' /tmp/tmp.config.yaml
sed -i 's*<node_label_value>*'"${NODE_LABEL}"'*g' /tmp/tmp.config.yaml
sed -i 's*<node_url_value>*'"${STRATO_HOST}"'*g' /tmp/tmp.config.yaml
sed -i 's*<oauth_appTokenCookieName_value>*'"${OAUTH_APP_TOKEN_COOKIE_NAME}"'*g' /tmp/tmp.config.yaml
sed -i 's*<oauth_openIdDiscoveryUrl_value>*'"${OAUTH_DISCOVERY_URL}"'*g' /tmp/tmp.config.yaml
sed -i 's*<oauth_clientId_value>*'"${OAUTH_CLIENT_ID}"'*g' /tmp/tmp.config.yaml
sed -i 's*<oauth_clientSecret_value>*'"${OAUTH_CLIENT_SECRET}"'*g' /tmp/tmp.config.yaml
sed -i 's*<oauth_scope_value>*'"${OAUTH_SCOPE}"'*g' /tmp/tmp.config.yaml
sed -i 's*<oauth_serviceOAuthFlow_value>*'"${OAUTH_SERVICE_OAUTH_FLOW}"'*g' /tmp/tmp.config.yaml
sed -i 's*<oauth_redirectUri_value>*'"${SERVER_HOST}/login/"'*g' /tmp/tmp.config.yaml
sed -i 's*<oauth_logoutRedirectUri_value>*'"${SERVER_HOST}"'*g' /tmp/tmp.config.yaml
sed -i 's*<oauth_tokenField_value>*'"${OAUTH_TOKEN_FIELD}"'*g' /tmp/tmp.config.yaml
sed -i 's*<oauth_tokenUsernameProperty_value>*'"${OAUTH_TOKEN_USERNAME_PROPERTY}"'*g' /tmp/tmp.config.yaml
sed -i 's*<oauth_tokenUsernamePropertyServiceFlow_value>*'"${OAUTH_TOKEN_USERNAME_PROPERTY_SERVICE_FLOW}"'*g' /tmp/tmp.config.yaml

mv /tmp/tmp.config.yaml ./config/generated.config.yaml
cp ./config/generated.config.yaml ${CONFIG_DIR_PATH}/config.yaml

echo 'Starting payment server...'
yarn start
