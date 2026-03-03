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

## 4) Run MercataBridge Migration

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

## 5) Run DepositRouter Safe Proposals (Upgrade + Setters)

### Testnet
```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/ethereum
npm run router:ops:testnet -- --step all
npm run router:ops:testnet -- --step all --apply
```

### Prod
```bash
cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/ethereum
npm run router:ops:prod -- --step all
npm run router:ops:prod -- --step all --apply
```

Implementation verification is attempted automatically during router upgrade propose and will not block the flow if verification fails.
