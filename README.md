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
|`BLOC_URL`|http://localhost/bloc/v2.1|
|`BLOC_DOC_URL`|http://localhost/docs/?url=/bloc/v2.1/swagger.json|
|`STRATO_URL`|http://localhost/strato-api/eth/v1.2|
|`STRATO_DOC_URL`|http://localhost/docs/?url=/strato-api/eth/v1.2/swagger.json|
|`CIRRUS_URL`|http://localhost/cirrus/search|
|`POLLING_FREQUENCY`|`5 * 1000`|

#### Example Docker Run command

```
docker run -d --name smd-ui -p 3035:3002 -e NODE_NAME=BAYAR6 -e BLOC_URL=http://bayar6.eastus.cloudapp.azure.com/bloc/v2.1 -e STRATO_URL=http://bayar6.eastus.cloudapp.azure.com/strato-api/eth/v1.2 blockapps/smd-ui
```
