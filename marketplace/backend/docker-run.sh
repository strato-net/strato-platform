#!/bin/sh
set -e

export CONFIG_DIR_PATH=/config
export DEPLOY_FILE_NAME=marketplace.deploy.yaml
export STRATO_NODE_PROTOCOL=${STRATO_NODE_PROTOCOL:-http}
export STRATO_NODE_HOST=${STRATO_NODE_HOST:-nginx}
export BASE_CODE_COLLECTION=${BASE_CODE_COLLECTION:-2f0964422e37bebb20799595b4b774c6a2211cc7} # Current deployment address on prod
export STRATO_HOSTNAME=${STRATO_HOSTNAME:-strato}
export STRATO_PORT_API=${STRATO_PORT_API:-3000}

echo "Waiting for STRATO to become available at ${STRATO_NODE_PROTOCOL}://${STRATO_NODE_HOST}/health ..."
until curl --silent --output /dev/null --fail --location ${STRATO_NODE_PROTOCOL}://${STRATO_NODE_HOST}/health ; do sleep 0.5 ; done
echo 'STRATO is available via nginx'

# confirm strato api is up, then query the /eth/v1.2/metadata for urls of payment server and oauth discovery
ETH_ENDPOINT=${STRATO_NODE_PROTOCOL}://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2
echo 'Waiting for STRATO API to be available...'
until curl --silent --output /dev/null --fail --location ${ETH_ENDPOINT}/stats/totaltx ; do sleep 1; done
echo 'STRATO API is available'
METADATA=$(curl --silent --fail ${ETH_ENDPOINT}/metadata)

# Set env vars with values from metadata (exporting and declaring separately - see https://github.com/koalaman/shellcheck/wiki/SC2155)
networkID=$(echo ${METADATA} | jq -r .networkID)
NOTIFICATION_SERVER_URL=$(echo ${METADATA} | jq -r .urls.notificationServer)
export networkID
export NOTIFICATION_SERVER_URL
if [ -z "${networkID}" ]; then
  echo "Could not get networkID from strato api, but it is a required value"
  exit 19
fi

# Validate configuration
if [ "${MP_IS_BOOTNODE}" = "false" ]; then
  if [ ! -f "${CONFIG_DIR_PATH}/${DEPLOY_FILE_NAME}" ]; then
    cp ./config/template.deploy.tpl.yaml ${CONFIG_DIR_PATH}/${DEPLOY_FILE_NAME}
    sed -i 's*__URL__*'"${STRATO_NODE_PROTOCOL}"'://'"${STRATO_NODE_HOST}"'*g' 
  fi
else
  if [ ! -f "${CONFIG_DIR_PATH}/config.yaml" ]; then
    if [ -f "${CONFIG_DIR_PATH}/${DEPLOY_FILE_NAME}" ]; then
      echo "App misconfigured: MP_IS_BOOTNODE=true, no config file but ${DEPLOY_FILE_NAME} is provided in docker volume. Exit."
      exit 54
    fi
  fi
fi

if [ ! -f "${CONFIG_DIR_PATH}/config.yaml" ]; then
  # Running container for the first time

  # Generating the ./config/generated.config.yaml - an intermediate step to avoid removing CONFIG var (that would break the non-docker deployment)
  cp ./config/template.config.yaml /tmp/tmp.config.yaml
  
  # Validate the env vars
  # TODO: check if EVERY env var is provided (in the for loop - refactor)
  if [ -z "${MP_SERVER_HOST}" ]; then
    echo "MP_SERVER_HOST is empty but is a required value"
    exit 11
  fi
  if [[ "${MP_SERVER_HOST}" = "http"* ]]; then
    echo "MP_SERVER_HOST must NOT start with protocol (http:// or https://)"
    exit 111
  fi
  if [[ "${MP_SERVER_HOST}" == *"\/" ]]; then
    echo "MP_SERVER_HOST must not contain the trailing slash"
    exit 112
  fi
  
  if [ -z "${MP_SERVER_SSL}" ]; then
    echo "ssl is empty but is a required value"
    exit 12
  fi
  
  if [ -z "${NODE_LABEL}" ]; then
    echo "NODE_LABEL is empty but is a required value"
    exit 13
  fi
  
  if [[ "${STRATO_NODE_PROTOCOL}" == *":"* ]]; then
    echo "STRATO_NODE_PROTOCOL should be one of: 'http', 'https'"
    exit 17
  fi
  
  if [ "${STRATO_NODE_HOST}" == "http"* ]; then
    echo "STRATO_NODE_HOST must not include the protocol and can only include hostname and port"
    exit 18
  fi
  
  if [ -z "${OAUTH_CLIENT_ID}" ]; then
    echo "OAUTH_CLIENT_ID is empty but is a required value"
    exit 15
  fi
  
  if [ -z "${OAUTH_CLIENT_SECRET}" ]; then
    echo "OAUTH_CLIENT_SECRET is empty but is a required value"
    exit 16
  fi
  
  # Create /etc/hosts record to resolve STRATO_HOST to STRATO_LOCAL_IP
  if [ -n "${STRATO_LOCAL_IP}" ]; then
    _STRATO_NODE_HOSTNAME=$(echo "${STRATO_NODE_HOST}" | cut -d ":" -f 1)
    _ETC_HOSTS_RECORD="${STRATO_LOCAL_IP} ${_STRATO_NODE_HOSTNAME}"
    echo "${_ETC_HOSTS_RECORD}" >> /etc/hosts
    echo "Record was added to /etc/hosts: '${_ETC_HOSTS_RECORD}'"
  fi
  
  [[ "${MP_SERVER_SSL}" = "true" ]] && SERVER_PROTOCOL="https" || SERVER_PROTOCOL="http"
  SERVER_URL="${SERVER_PROTOCOL}://${MP_SERVER_HOST}"

  OAUTH_OPENID_DISCOVERY_URL=$(echo ${METADATA} | jq -r .urls.oauthDiscovery)
  if [ -z "${OAUTH_OPENID_DISCOVERY_URL}" ]; then
    echo "Could not get OAuth discovery url from strato api, but it is a required value"
    exit 21
  fi

  sed -i 's*<apiDebug_value>*'"${MP_API_DEBUG}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<configDirPath_value>*'"${CONFIG_DIR_PATH}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<deployFilename_value>*'"${DEPLOY_FILE_NAME}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<serverHost_value>*'"${SERVER_URL}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<node_label_value>*'"${NODE_LABEL}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<node_url_value>*'"${STRATO_NODE_PROTOCOL}://${STRATO_NODE_HOST}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<oauth_appTokenCookieName_value>*'"${OAUTH_APP_TOKEN_COOKIE_NAME}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<oauth_openIdDiscoveryUrl_value>*'"${OAUTH_OPENID_DISCOVERY_URL}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<oauth_clientId_value>*'"${OAUTH_CLIENT_ID}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<oauth_clientSecret_value>*'"${OAUTH_CLIENT_SECRET}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<oauth_scope_value>*'"${OAUTH_SCOPE}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<oauth_serviceOAuthFlow_value>*'"${OAUTH_SERVICE_OAUTH_FLOW}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<oauth_redirectUri_value>*'"${SERVER_URL}/mp-login/"'*g' /tmp/tmp.config.yaml
  sed -i 's*<oauth_logoutRedirectUri_value>*'"${SERVER_URL}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<oauth_tokenField_value>*'"${OAUTH_TOKEN_FIELD}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<oauth_tokenUsernameProperty_value>*'"${OAUTH_TOKEN_USERNAME_PROPERTY}"'*g' /tmp/tmp.config.yaml
  sed -i 's*<oauth_tokenUsernamePropertyServiceFlow_value>*'"${OAUTH_TOKEN_USERNAME_PROPERTY_SERVICE_FLOW}"'*g' /tmp/tmp.config.yaml

  mv /tmp/tmp.config.yaml ./config/generated.config.yaml
  
  if test -f "${CONFIG_DIR_PATH}/${DEPLOY_FILE_NAME}"; then
    echo "deploy file exists - secondary node - nothing to deploy"
    cp ./config/generated.config.yaml ${CONFIG_DIR_PATH}/config.yaml
  else
    echo "deploy file does not exist - bootnode - running 'deploy'"
    if [ "${MP_DELAY_DEPLOYMENT}" == "true" ]; then
      touch _deploy_blocked_while_I_exist
      echo "Deployment blocked until file ./_deploy_blocked_while_I_exist is removed from the container... Waiting..."
      until [ ! -f ./_deploy_blocked_while_I_exist ]; do sleep 1; done
      echo "_deploy_blocked_while_I_exist file removed, continue with deploy script..."
    fi
    
    CONFIG=generated yarn deploy
  fi
  
else
  # This container was already running before
  if test -f "${CONFIG_DIR_PATH}/${DEPLOY_FILE_NAME}"; then
    echo "Config and deploy files exist - skipping deploy and running the app"
    if [ ! -f "${CONFIG_DIR_PATH}/.deployed" ]; then
      echo "ERROR: Config and deploy files exist but the deploy was not successfully finished: if running the secondary node, most probably there was an error in deployment when the container was started for the first time"
      exit 52
    fi
  else
    echo "Error: the config.yaml file is provided but the deploy file is missing, please check the docker volume for /config"
    exit 51
  fi  
fi

# Replace Base code collection address in Solidity contracts
find . -type f -name '*.sol' -exec sed -i 's*BASE_CODE_COLLECTION*'"${BASE_CODE_COLLECTION}"'*g' {} +

# Create or empty (if was modified manually) the .env
# .env is NOT used in containerized deployment (use exported env vars instead), but the file is still required for dotenv lib to not crash
echo '' > .env

touch ${CONFIG_DIR_PATH}/.deployed

echo 'Starting backend server...'
yarn start:prod
