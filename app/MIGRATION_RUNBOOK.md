# Migration Runbook (Single Flow)

## 0) Required Environment

### `/Users/ariya/Documents/BlockApps/strato-platform/mercata/contracts/.env`
```bash
GLOBAL_ADMIN_NAME=
GLOBAL_ADMIN_PASSWORD=
NODE_URL=
OAUTH_URL=
OAUTH_CLIENT_ID=
OAUTH_CLIENT_SECRET=
```

### `/Users/ariya/Documents/BlockApps/strato-platform/mercata/ethereum/.env`
```bash
SAFE_PROPOSER_ADDRESS=
SAFE_PROPOSER_PRIVATE_KEY=
SAFE_API_KEY=
BA_USERNAME=
BA_PASSWORD=
CLIENT_ID=
CLIENT_SECRET=
OPENID_DISCOVERY_URL=
ALCHEMY_API_KEY=
ROUTER_IMPL_ETH=
ROUTER_IMPL_BASE=
```

## 1) Build Once

```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/services/bridge
npm install
npm run build
```

```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/ethereum
npm install
npm run compile
```

```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/contracts
npm install
```

## 2) Deploy DepositRouter Implementations

### Testnet
```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/ethereum
npm run deployImpl:sepolia
npm run deployImpl:baseSepolia
```

### Prod
```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/ethereum
npm run deployImpl:mainnet
npm run deployImpl:base
```

## 3) Set Implementation Addresses

Update `/Users/ariya/Documents/BlockApps/strato-platform/mercata/ethereum/.env`:
- `ROUTER_IMPL_ETH=<ethereum implementation address>`
- `ROUTER_IMPL_BASE=<base implementation address>`

## 4) Upgrade MercataBridge Proxy First

Run this before any bridge route config calls.

### Testnet
```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/contracts
npm run upgrade -- \
  --proxy-address 1008 \
  --contract-file BaseCodeCollection.sol \
  --contract-name MercataBridge \
  --constructor-args '{"_owner":"deadbeef"}' \
  +OVERRIDE-CHECKS
```

### Prod
```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/contracts
npm run upgrade -- \
  --proxy-address 1008 \
  --contract-file BaseCodeCollection.sol \
  --contract-name MercataBridge \
  --constructor-args '{"_owner":"deadbeef"}' \
  +OVERRIDE-CHECKS
```

If this returns a governance vote issue, approve/finalize it before continuing.

## 5) Run MercataBridge Migration

### Testnet
```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/contracts
npm run bridge:ops:testnet
npm run bridge:ops:testnet -- --apply
```

### Prod
```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/contracts
npm run bridge:ops:prod
npm run bridge:ops:prod -- --apply
```

## 6) DepositRouter Upgrade (Phase 1)

Run router upgrade proposals first. Do not queue setters in the same run.

### Testnet
```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/ethereum
npm run router:ops:testnet -- --step upgrade
npm run router:ops:testnet -- --step upgrade --apply
```

### Prod
```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/ethereum
npm run router:ops:prod -- --step upgrade
npm run router:ops:prod -- --step upgrade --apply
```

Approve and execute all queued upgrade proposals in Safe before continuing.

## 7) DepositRouter Route Setters (Phase 2)

Queue route setters only after:
1) MercataBridge migration is executed, and
2) DepositRouter upgrade proposals are executed.

`depositRouterQueueSetters` reads MercataBridge `assets` + `assetRouteEnabled` mappings to build `setRoutePermitted`, so execution order matters.

### Testnet
```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/ethereum
npm run router:ops:testnet -- --step setters
npm run router:ops:testnet -- --step setters --apply
```

### Prod
```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/ethereum
npm run router:ops:prod -- --step setters
npm run router:ops:prod -- --step setters --apply
```

Implementation verification is attempted automatically during router upgrade propose and will not block the flow if verification fails.
