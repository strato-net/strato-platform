# tCommerce

## Setup and Execution

### Dependencies

The following tools should already be installed

1. docker 17.06+
2. docker-compose 17.06+
3. NodeJS 14.19.1+ (for development mode only)
4. yarn or npm (for development mode only)

### Run tCommerce application locally (for development)

#### Start nginx

Nginx acts as a proxy for the frontend and the backend. It is required so that both the frontend and the backend have the same root URL (required for authentication).

```
cd tCommerce/nginx-docker
```

If you are running on Linux, execute the following command:
```
HOST_IP=172.17.0.1 docker-compose up -d
```

If you are running on Mac, execute the following command:
```
HOST_IP=docker.for.mac.localhost docker-compose up -d
```

#### Deploy the Dapp and Start The Backend

```
cd tCommerce/backend
```

1. Create a `.env` file with the below credentials: (In local development, Please make sure the value of `GLOBAL_ADMIN_NAME` `<globalAdminUserName>` is set to the login that you will be using to login to the app) 
```
GLOBAL_ADMIN_NAME=<globalAdminUsername>
GLOBAL_ADMIN_PASSWORD=<globalAdminPassword>

EXT_STORAGE_S3_ACCESS_KEY_ID=<s3Key>
EXT_STORAGE_S3_SECRET_ACCESS_KEY=<s3AccessKey>
EXT_STORAGE_S3_BUCKET=<s3Bucket>

# accounts for testing user roles
TRADINGENTITY_NAME=<tradingEntityUsername>
TRADINGENTITY_PASSWORD=<tradingEntityPassword>
CERTIFIER_NAME=<certifierUserName>
CERTIFIER_PASSWORD=<certifierPassword>

# accounts for testing buyer and sellers access although the user role is TRADING ENTITY
TEST_BUYER_ORG=<buyerUsername>
TEST_BUYER_PASSWORD=<buyerPassword>
TEST_SELLER_ORG=<sellerUsername>
TEST_SELLER_PASSWORD=<sellerPassword>

# blockapps stripe account
STRIPE_PUBLISHABLE_KEY=<stripePublishableKey>
STRIPE_SECRET_KEY=<stripeSecretKey>
```
2. Install dependencies: 
```
yarn install
```

3. Deploy contracts:
```
CONFIG=mercata yarn deploy
# CONFIG var can be skipped if using `mercata` config - it is the default config name used (config/mercata.config.yaml)
# If you have a custom config file `config/<myConfig>.config.yaml`, set `CONFIG=myConfig`
```

Start the backend server:
```
yarn start
```

*NOTE: `yarn start` will start the server and use the terminal window to dump log information. To stop the server, hit `CTRL+C`*.


#### Launch UI

In a new terminal window, run the following commands:

```
cd tCommerce/ui
yarn install
yarn develop
```

This should open a browser window and display a basic React webpage.

*NOTE: Please make sure that `nginx` is up WITH CORRECT HOST_IP (see above).*

*NOTE: Your IP address may change if you change the WIFI or in other reasons. In that case restart nginx container with actual HOST_IP.*

*NOTE: `yarn develop` will start the UI and use the terminal window to dump log information. To stop the UI, hit `CTRL+C`*.

#### Stopping the App

To stop the app, hit `CTRL+C` on the server and UI windows. To stop the nginx server, run
```
docker stop nginx-docker_nginx_1
```


### Run tCommerce app in Docker (the production way)

#### 1. Build the APP

Inside strato-platform directory run the follow commands:

```
REPO=local make
```

Copy the `docker-compose.yml` file from `strato-platform` to `strato-getting-started` directory.

```
cp ../strato-platform/docker-compose.yml ../strato-getting-started
```

#### 2. Build docker images

Inside strato-getting-started directory run the docker containers using the executale script `run-app.sh`:

#### 2a. Run as tCommerce bootnode (main node in multi-node environment)
1. Fill in the following fields in the run-app.sh script and run it:
    ```
    MP_IS_BOOTNODE=true
    BOOT_NODE_IP="52.4.166.179" \
    NODE_HOST="localhost:8080" \
    HTTP_PORT="8080" \
    networkID="145412593591711493194520550465176298862" \
    OAUTH_DISCOVERY_URL="https://keycloak.blockapps.net/auth/realms/mercata-testnet2/.well-known/openid-configuration" \
    OAUTH_CLIENT_ID="localhost" \
    OAUTH_CLIENT_SECRET="???" \
    ssl="true" \
    VAULT_URL="https://vault.blockapps.net:8093" \
    EXT_STORAGE_S3_BUCKET='mercata-testnet2' \
    EXT_STORAGE_S3_ACCESS_KEY_ID='???' \
    EXT_STORAGE_S3_SECRET_ACCESS_KEY='???' \
    STRIPE_PUBLISHABLE_KEY='??' \
    STRIPE_SECRET_KEY='???' \
    STRATO_NODE_HOST="node1.mercata-testnet2.blockapps.net" \
    STRATO_NODE_PROTOCOL="https" \
    ./strato
    ```
   (For additional parameters, see "docker-compose.yml env vars reference" below)

2. Make the script executable:
    ```
    chmod +x run-app.sh
    ```
   
3. Run the script:
    ```
    ./run-app.sh
    ```

4. Wait for all docker containers to become healthy (`sudo docker ps`)

*NOTE: Running the command `sudo docker-compose down -vt0 && sudo ./run-app.sh` will clean the app data and then run the app from scratch*


#### 2b. Run as app secondary node (in multi-node environment)
Secondary node is the one that connects to the existing Dapp contract on the blockchain (which is initially deployed on app bootnode)

1. Fill in the following fields in the `run-app-secondary.sh` script and run it:
    ```
    MP_IS_BOOTNODE=false
    BOOT_NODE_IP="52.4.166.179" \
    NODE_HOST="localhost:8080" \
    HTTP_PORT="8080" \
    networkID="145412593591711493194520550465176298862" \
    OAUTH_DISCOVERY_URL="https://keycloak.blockapps.net/auth/realms/mercata-testnet2/.well-known/openid-configuration" \
    OAUTH_CLIENT_ID="localhost" \
    OAUTH_CLIENT_SECRET="???" \
    ssl="true" \
    VAULT_URL="https://vault.blockapps.net:8093" \
    EXT_STORAGE_S3_BUCKET='mercata-testnet2' \
    EXT_STORAGE_S3_ACCESS_KEY_ID='???' \
    EXT_STORAGE_S3_SECRET_ACCESS_KEY='???' \
    STRIPE_PUBLISHABLE_KEY='??' \
    STRIPE_SECRET_KEY='???' \
    STRATO_NODE_HOST="node1.mercata-testnet2.blockapps.net" \
    STRATO_NODE_PROTOCOL="https" \
    ./strato
    ```
    (For additional parameters or further information, see "docker-compose.yml env vars reference" below)  

    *NOTE: If you are getting a bash error saying "`Permission denied`". You may need to run (`chmod +x run-app-secondary.sh`) before running the script again.*


#### docker-compose.yml env vars reference
Some docker-compose vars are optional with default values and some are required for prod or specific OAuth provider setup.

```
MP_IS_BOOTNODE              - (default: 'false') if false - .deploy.yaml is expected in docker volume
MP_API_DEBUG                - (default: 'false') show additional logs of STRATO API calls in backend container log
CONFIG_DIR_PATH             - (default: '/config') directory inside of container to keep the config and deploy yaml files. Not recommended to change unless you know what you are doing.
MP_DAPP_ADDRESS             - (required for MP_IS_BOOTNODE=false) the address of the pre-existing Marketplace Dapp contract (for MP_IS_BOOTNODE=false mode only)
ORG_DEPLOY_FILE_NAME        - (default: 'org.deploy.yaml') filename of the targeted org deploy file. Not recommended to change unless you know what you are doing.
APPLICATION_USER_NAME       - (default: 'APP_USER') the username of service user
MP_SERVER_HOST              - (required) App server host (hostname or hostname:port, e.g. example.com) of the application server
SERVER_IP                   - (required) IP address of the machine (preferably public one or the private that is accessible from other nodes in network)
NODE_LABEL                  - (required) String representing the node identificator (e.g. tCommerce-node1)
STRATO_NODE_PROTOCOL        - (default: 'http') Protocol of the STRATO node (http|https)
STRATO_NODE_HOST            - (default: 'strato_nginx_1:80') host (hostname:port) of the STRATO node. By default - call STRATO node in the linked docker network (see bottom of docker-compose.yml)
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
