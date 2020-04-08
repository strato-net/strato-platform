# smd-ui

UI for Strato Management Dashboard


## Pre-requisite setup:

```
install node.js npm
```

## Dependencies

SMD needs a running STRATO platform, options:

  -- Run STRATO platform (Private Ethereum Blockchain node) on your machine or a VM:

     https://github.com/blockapps/strato-getting-started

  -- OR, run STRATO platform (Private Ethereum Blockchain node) using Azure Marketplace

## Deploying and Running SMD Web UI against LOCALHOST

1) Clone this repo

2) Type the following command to run the UI.

```
npm i
npm run start
```

## Environment Variables for Packaging


| Variable | Default |
| -------- | ------- |
|`NODE_NAME`|LOCALHOST|
|`BLOC_URL`|http://localhost/bloc/v2.2|
|`BLOC_DOC_URL`|http://localhost/docs/?url=/bloc/v2.2/swagger.json|
|`STRATO_URL`|http://localhost/strato-api/eth/v1.2|
|`STRATO_DOC_URL`|http://localhost/docs/?url=/strato-api/eth/v1.2/swagger.json|
|`CIRRUS_URL`|http://localhost/cirrus/search|
|`POLLING_FREQUENCY`|`5 * 1000`|

#### Example Docker Run command

```
docker run -d --name smd-ui -p 3035:3002 -e NODE_NAME=BAYAR6 -e BLOC_URL=http://bayar6.eastus.cloudapp.azure.com/bloc/v2.2 -e STRATO_URL=http://bayar6.eastus.cloudapp.azure.com/strato-api/eth/v1.2 blockapps/smd-ui
```

## Setup for Developer Mode (OAuth Mode)
*NOTE:* Please use this steps for the development mode

**STEP 1:** Nginx config

```
cd nginx-packager
COPY the content from nginx.tpl.smd and paste it to nginx.tpl.conf
REPO=local make nginx
```
*NOTE:* Don't commit these changes

**STEP 2:** Start Strato with Oauth Mode
```
cd strato-getting-started

HTTP_PORT=8080 \
NODE_HOST=localhost:8080 \
OAUTH_ENABLED=true \
OAUTH_CLIENT_ID=dev-infinite \ OAUTH_CLIENT_SECRET=091a22ec-3c81-4be4-83fb-d9f82084c3e8 \ OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration \ 
OAUTH_JWT_USERNAME_PROPERTY=email \
./strato.sh --single
```

*NOTE:* Don't wait for the strato to fully start in the meanwhile you have to start the smd-ui using below steps

**STEP 3:** 
```
cd smd-ui/
rename docker-development.yml to docker-compose.yml
rename Dockerfile-development to Dockerfile

docker-compose build
NODE_HOST=localhost:8080 OAUTH_ENABLED=true docker-compose up
```

## Setup for Developer Mode (Non-OAuth Mode)

Remove the statement from the saga:

`credentials: "include"`