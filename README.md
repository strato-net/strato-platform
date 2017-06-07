# smd-ui

UI for Strato Management Dashboard

## Pre-requisite setup:

  -- install node.js npm

## Dependencies

SMD needs a running STRATO platform, options:
  
  -- Run STRATO platform (Private Ethereum Blockchain node) on your machine or a VM:

     https://github.com/blockapps/strato-getting-started

  -- OR, run STRATO platform (Private Ethereum Blockchain node) using Azure Marketplace

## Deploying and Running SMD Web UI

1) Clone this repo

2) Update the STRATO platform URL in SMD-UI environment config: smd-ui/src/env.js specifically these two parameters:
```
    name: 'strato-local',
    url: 'http://localhost/'
```

## Starting SMD Web UI

Type the following command to run the UI.

```
npm i
npm start
```
