# STRATO Mercata Marketplace

## Setup and Execution

### Dependencies

The following tools should be preinstalled to run Marketplace:

1. Docker Engine v24+
2. Docker Compose V2
3. NodeJS 21.7.1 (for development mode only)
4. yarn (for development mode only)

*NOTE* the required NodeJS version. The app may not work properly on the newer or older Node versions. Refer to Dockerfile first line to check what is tested for Production deployment.


### Run Marketplace application locally (for development)

#### Start nginx

Nginx acts as a proxy for the frontend and the backend. It is required so that both the frontend and the backend have the same root URL (required for authentication).

For Docker Engine v.24+ (year 2023):
```
cd nginx-docker
HOST_IP=host.docker.internal docker-compose up -d --build
```
(for older Docker versions on Linux: `HOST_IP=172.17.0.1 docker compose up -d --build`; on Mac: `HOST_IP=docker.for.mac.localhost docker compose up -d --build`)

#### Deploy the Dapp and Start The Backend

```
cd backend
```

1. Create a `.env` file with the below credentials: (In local development, Please make sure the value of `GLOBAL_ADMIN_NAME` `<globalAdminUserName>` is set to the login that you will be using to login to the app) 
```
GLOBAL_ADMIN_NAME=<globalAdminUsername>
GLOBAL_ADMIN_PASSWORD=<globalAdminPassword>

NOTIFICATION_SERVER_URL=<notificationServerUrl>
networkID=<networkID>

### VARS USED IN BACKEND TESTS ONLY: ###
#  accounts for testing user roles:
CERTIFIER_NAME=<certifierUserName>
CERTIFIER_PASSWORD=<certifierPassword>
# accounts for testing buyer and sellers access although the user role is TRADING ENTITY:
TEST_BUYER_ORG=<buyerUsername>
TEST_BUYER_PASSWORD=<buyerPassword>
TEST_SELLER_ORG=<sellerUsername>
TEST_SELLER_PASSWORD=<sellerPassword>
```

2. Update `config/localhost.config.yaml`

In `config/localhost.config.yaml` file change the `url` value (under `nodes[0]`) to be a full url to a STRATO node (e.g. https://example.com, or https://example.com:8080 if STRATO is running on custom port)

3. Install dependencies: 
```
yarn install
```

4. Deploy Dapp contracts to blockchain:
```
yarn deploy:develop
```

Start the backend webserver:
```
yarn start
```

#### Launch UI

In a new terminal window, run the following commands:

```
cd ui
yarn install
yarn develop
```

This should open a browser window and display a basic React webpage.

*NOTE: Please make sure that you run `nginx-docker` with proper HOST_IP (see nginx part above).*

#### Stopping the App
Once you are done with Marketplace development, also stop the Nginx-docker container:

To stop the app, hit `CTRL+C` on the server and UI windows. To stop the nginx server, run
```
cd nginx-docker
docker compose down
```


## Cypress Tests
There are two options: 
1. Using explorer
```
cd ui
yarn run cypress open 
```
*NOTE: Select E2E testing in the dialog*

2. Using CLI
```
yarn test:e2e
```




###############################################

### OBSOLETE: Run marketplace app in Docker (the production way)

*Important:* The Marketplace is deployed as part of the STRATO Platform for production use. The information below is kept here for future reference but is not expected to work as is.

#### 1. Build docker images
```
sudo docker compose build
```

#### 2a. Run as tCommerce bootnode (main node in multi-node environment)
1. Fill in the following fields in the run-app.sh script and run it:
    ```

    export MP_IS_BOOTNODE=true
    export MP_API_DEBUG=true
    export MP_SERVER_HOST=<your external IP address> # can't use 127.0.0.1
    export SERVER_IP=<your external IP address> # can't use 127.0.0.1
    export OAUTH_OPENID_DISCOVERY_URL=https://<oauth provider url>/.well-known/openid-configuration
    export OAUTH_CLIENT_ID=<oauth provider client id>
    export OAUTH_CLIENT_SECRET=<oauth provider client secret>
    export NODE_LABEL='My boot node'
    export SSL=true
    ```
   (For additional parameters, see "docker-compose.yml env vars reference" below)

2. Make the script executable:
    ```
    chmod +x run-app.sh
    ```
   
3. Wait for all docker containers to become healthy (`sudo docker ps`)

*NOTE: Running the command `sudo docker compose down -vt0 && sudo ./run-app.sh` will clean the app data and then run the app from scratch*


#### 2b. Run as app secondary node (in multi-node environment)
Secondary node is the one that connects to the existing Dapp contract on the blockchain (which is initially deployed on app bootnode)

1. On bootnode - Get deploy file content:
    ```
    sudo docker exec tcommerce_backend_1 cat /config/tCommerce.deploy.yaml
    ```
2. On secondary node - create docker volume and add the same tCommerce.deploy.yaml file using commands:
    ```
    sudo su
    docker volume create tcommerce_config
    APP_CONFIG_VOLUME_DIR=$(docker volume inspect --format '\{\{ .Mountpoint \}\}' tcommerce_config)
    nano ${APP_CONFIG_VOLUME_DIR}/tCommerce.deploy.yaml
    # paste content and save
    exit
    ```
3. Fill in the following fields in the `run-app-secondary.sh` script and run it:
    ```
    export MP_IS_BOOTNODE='false'
    export MP_API_DEBUG='true'
    export MP_SERVER_HOST='<MP_SERVER_HOST>'                                # ex: localhost
    export SERVER_IP='<SERVER_IP>'                                          # ex: 123.123.123.123
    export NODE_LABEL='<NODE_LABEL>                                         # ex: tcommerce_secondary                         
    export OAUTH_APP_TOKEN_COOKIE_NAME='<OAUTH_APP_TOKEN_COOKIE_NAME>'      # ex: tCommerce-node1-session
    export OAUTH_OPENID_DISCOVERY_URL='<OAUTH_OPENID_DISCOVERY_URL>'        # ex: https://<oauth provider url>/.well-known/openid-configuration
    export OAUTH_CLIENT_ID='<OAUTH_CLIENT_ID>'                              # ex: abcdef
    export OAUTH_CLIENT_SECRET='<OAUTH_CLIENT_SECRET>'                      # ex: abcdef12-abcd-abcd-abcd-abcdefabcedf
    export OAUTH_TOKEN_USERNAME_PROPERTY='preferred_username'               # Do not change unless you know what you are doing.
    export OAUTH_TOKEN_USERNAME_PROPERTY_SERVICE_FLOW='preferred_username'  # Do not change unless you know what you are doing.
    export STRATO_NODE_PROTOCOL='https'
    export STRATO_NODE_HOST='<STRATO_NODE_HOST>'                            # ex: node1.mercata-testnet.blockapps.net
    export SSL=true
    export SSL_CERT_TYPE=pem
    export DAEMONS_ENABLED='true'
    ```
    (For additional parameters or further information, see "docker-compose.yml env vars reference" below)  

    *NOTE: If you are getting a bash error saying "`Permission denied`". You may need to run (`chmod +x run-app-secondary.sh`) before running the script again.*


#### docker-compose.yml env vars reference
Some docker-compose vars are optional with default values and some are required for prod or specific OAuth provider setup.

```
MP_IS_BOOTNODE              - (default: 'false') if false - .deploy.yaml is expected in docker volume
MP_API_DEBUG                - (default: 'false') show additional logs of STRATO API calls in backend container log
CONFIG_DIR_PATH             - (default: '/config') directory inside of container to keep the config and deploy yaml files. Not recommended to change unless you know what you are doing.
ORG_DEPLOY_FILE_NAME        - (default: 'org.deploy.yaml') filename of the targeted org deploy file. Not recommended to change unless you know what you are doing.
APPLICATION_USER_NAME       - (default: 'APP_USER') the username of service user
MP_SERVER_HOST              - (required) App server host (hostname or hostname:port, e.g. example.com) of the application server
SERVER_IP                   - (required) IP address of the machine (preferably public one or the private that is accessible from other nodes in network)
NODE_LABEL                  - (required) String representing the node identificator (e.g. tCommerce-node1)
STRATO_NODE_PROTOCOL        - (default: 'http') Protocol of the STRATO node (http|https)
STRATO_NODE_HOST            - (default: 'nginx', no port defaults to 80) host (hostname:port) of the STRATO node. By default - call STRATO node in the linked docker network (see bottom of docker-compose.yml)
STRATO_LOCAL_IP             - (default: empty string, optional) Useful for Prod when STRATO is running on https and we have to call it by real DNS name (SSL requirement) but need to resolve it through the local network (e.g. STRATO port is closed to the world). Non-empty value will create /etc/hosts record in container to resolve hostname provided in STRATO_HOST to STRATO_LOCAL_IP. Example: `172.17.0.1` (docker0 IP of machine - see `ifconfig`). Otherwise - will resolve hostname with public DNS. 
NODE_PUBLIC_KEY             - (default: dummy hex public key) STRATO node's blockstanbul public key
OAUTH_APP_TOKEN_COOKIE_NAME - (default: 'tCommerce_session') Browser session cookie name for the node, e.g. tCommerce-node1-session'
OAUTH_OPENID_DISCOVERY_URL  - (required) OpenID discovery .well-known link
OAUTH_CLIENT_ID             - (required) OAuth client id (Client should have the redirect uri `/api/v1/authentication/callback` set up on OAuth provider)
OAUTH_CLIENT_SECRET         - (required) OAuth client secret
OAUTH_SCOPE                 - (default: 'openid email') - custom OAuth scope (e.g. for Azure AD v2.0 authentication: 'openid offline_access <client_secret>/.default')
OAUTH_SERVICE_OAUTH_FLOW    - (default: 'client-credential') - OAuth flow to use for programmatic token fetch (refer to blockapps-rest options)
OAUTH_TOKEN_FIELD           - (default: 'access_token') - value of the service flow response to use as access token (e.g. 'access_token'|'id_token')
OAUTH_TOKEN_USERNAME_PROPERTY               - (default: 'email') - OAuth access token's property to use as user identifier in authorization code grant flow (e.g. 'email' for Keycloak, 'upn' for Azure AD)
OAUTH_TOKEN_USERNAME_PROPERTY_SERVICE_FLOW  - (default: 'email') - OAuth access token's property to use as user identifier in oauth service (e.g. client-credential) flow (e.g. 'email for Keycloak, 'oid' for Azure AD)
SSL                         - (default: 'true')    - rather to run on http or https ('false'|'true') (see SSL cert letsencrypt tool section for fetching the cert)
SSL_CERT_TYPE               - (default: 'crt') SSL cert file type ('crt'|'pem') - see "SSL cert letsencrypt tool" for steps to get/provide cert
```

#### SSL cert letsencrypt tool (optional - for production deployments)

The tool automates the process of obtaining the real SSL certificate using certbot and letsencrypt to use for running application on https:// for production.
Certs are valid for 3 months and should be auto-updated. 
To run the Application we need the first (initial) certificate to provide it to the container. 
After that, when the Application is already running, the certificate will be automatically renewed (see "Setup auto-renewal")

For steps to use letsencrypt tool please refer to tCommerce/nginx-docker/letsencrypt/README.md

#### Obtaining OAuth access token (optional)

Each call made to STRATO API requires the valid access token obtained from OAuth provider (the App and the STRATO node should use same OpenID Discovery URL)
In the `yarn deploy` step the application is programmatically fetching the access token of the service user (with Client Credentials Grand flow of OAuth2) in order to make the API calls with it.

During development you may also want to obtain the token of the specific user using some of the standard OAuth2 flows.

The token can be obtained by using the `token-getter` utility packaged in `blockapps-rest`. 
To use this utility, run `sudo yarn token-getter` from the `backend` directory:

```
cd tCommerce/backend
sudo yarn token-getter
```
*NOTE: You may need to stop your nginx container to release the port for token-getter*


This command launches a small web server on the same host (hostname and port) specified in the `redirectUri` field of `config/localhost.config.yaml`. This field was filled in by the app-framework utility from the configuration parameters it collected from the user.
- Copy the URL shown by the `token-getter` utility and enter it into your browser.
- Log in with your OAuth provider credentials.
- Once logged in, the web server will display the token on a web page. 
- Copy the "Access Token".
- Hit `CTRL+C` to quit the `token-getter`.

For additional help on token-getter:
```
sudo yarn token-getter -- --help
```

#### Selenium tests

Install chrome webdriver on your machine (https://chromedriver.chromium.org/downloads) then follow these steps:

```
cd tCommerce/selenium
yarn test:selenium
```

Refer the inital testcases.
