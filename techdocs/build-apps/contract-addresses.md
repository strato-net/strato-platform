# Contract Reference

Deployed contracts and addresses for STRATO platform.

!!! tip "Get Addresses Dynamically"
    Contract addresses are **not hardcoded** in documentation. Fetch them dynamically from the backend or blockchain to ensure accuracy.

---

## How to Get Contract Addresses

### Method 1: Via Backend Services (Recommended)

Contract addresses are managed via backend environment variables and accessible through internal services:

```javascript
// The backend exposes registries that contain all contract addresses

// Example: Get Lending contracts
const response = await axios.get(`${BASE_URL}/lending/registry`, {
  headers: { 'Authorization': `Bearer ${accessToken}` }
});

const {
  lendingPool,
  collateralVault,
  priceOracle,
  liquidityPool
} = response.data;

console.log('Lending Pool:', lendingPool.address);
console.log('Collateral Vault:', collateralVault.address);

// Example: Get CDP contracts
const cdpResponse = await axios.get(`${BASE_URL}/cdp/registry`, {
  headers: { 'Authorization': `Bearer ${accessToken}` }
});

const {
  cdpEngine,
  cdpVault,
  usdst
} = cdpResponse.data;

console.log('CDP Engine:', cdpEngine.address);
console.log('USDST Token:', usdst);
```

### Method 2: From Environment Variables

Contract addresses are configured via environment variables in the backend:

```bash
# Core Registry Contracts
LENDING_REGISTRY=0000000000000000000000000000000000001007
CDP_REGISTRY=0000000000000000000000000000000000001012

# Factory Contracts
POOL_FACTORY=000000000000000000000000000000000000100a
TOKEN_FACTORY=000000000000000000000000000000000000100b

# System Contracts
ADMIN_REGISTRY=000000000000000000000000000000000000100c
MERCATA_BRIDGE=0000000000000000000000000000000000001008
REWARDS_CHEF=000000000000000000000000000000000000101f
POOL_CONFIGURATOR=0000000000000000000000000000000000001006
VOUCHER_CONTRACT_ADDRESS=000000000000000000000000000000000000100e
```

### Method 3: Query Blockchain Directly

```javascript
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider(
  'https://app.strato.nexus/strato-api/eth/v1.2'
);

// Query LendingRegistry to get all lending contracts
const LENDING_REGISTRY = '0000000000000000000000000000000000001007';
const registryABI = [
  'function lendingPool() view returns (address)',
  'function collateralVault() view returns (address)',
  'function priceOracle() view returns (address)'
];

const registry = new ethers.Contract(LENDING_REGISTRY, registryABI, provider);

const lendingPool = await registry.lendingPool();
const collateralVault = await registry.collateralVault();
const priceOracle = await registry.priceOracle();

console.log('Lending Pool:', lendingPool);
console.log('Collateral Vault:', collateralVault);
console.log('Price Oracle:', priceOracle);
```

---

## Core Registry Addresses

These **registry contracts** are the entry points to discover all other contracts:

### Mainnet & Testnet

| Registry | Address | Description |
|----------|---------|-------------|
| **LendingRegistry** | `0000000000000000000000000000000000001007` | Entry point for all lending contracts |
| **CDPRegistry** | `0000000000000000000000000000000000001012` | Entry point for all CDP contracts |
| **PoolFactory** | `000000000000000000000000000000000000100a` | AMM pool factory |
| **TokenFactory** | `000000000000000000000000000000000000100b` | Token creation factory |
| **AdminRegistry** | `000000000000000000000000000000000000100c` | Admin permissions |
| **Bridge** | `0000000000000000000000000000000000001008` | Cross-chain bridge |
| **RewardsChef** | `000000000000000000000000000000000000101f` | Rewards distribution |

!!! info "Registry Pattern"
    STRATO uses the **registry pattern** where top-level contracts point to all deployed contracts. Query registries to get current addresses instead of hardcoding them.

---

## Network Details

### STRATO Mainnet

```javascript
{
  chainId: ..., // Check with team
  name: 'STRATO',
  rpcUrls: ['https://app.strato.nexus/strato-api/eth/v1.2'],
  blockExplorerUrls: ['https://explorer.strato.nexus'],
  nativeCurrency: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18
  }
}
```

### STRATO Testnet (Buildtest)

```javascript
{
  chainId: ..., // Check with team
  name: 'STRATO Testnet',
  rpcUrls: ['https://buildtest.mercata-testnet.blockapps.net/strato-api/eth/v1.2'],
  blockExplorerUrls: ['https://buildtest-explorer.mercata-testnet.blockapps.net'],
  nativeCurrency: {
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18
  }
}
```

---

## Contract Verification

All contracts are verified on the block explorer. You can:

1. **View source code** - See contract implementation
2. **Read contract** - Call view functions
3. **Write contract** - Execute transactions
4. **View events** - Monitor contract activity

**Example:**
```
https://explorer.strato.nexus/address/0x.../contracts
```

---

## ABIs

### Download ABIs

Get the latest ABIs from:

- **GitHub**: [github.com/blockapps/strato-contracts](https://github.com/blockapps/strato-contracts)
- **NPM**: `npm install @blockapps/strato-contracts`
- **API**: `GET https://app.strato.nexus/api/contracts/abis`

### Use in Code

```javascript
// Option 1: From NPM package
const { LendingPoolABI } = require('@blockapps/strato-contracts');

// Option 2: Fetch from API
const response = await fetch('https://app.strato.nexus/api/contracts/abis');
const abis = await response.json();

// Option 3: Use human-readable ABI (ethers.js)
const abi = [
  'function borrow(address asset, uint256 amount)',
  'function getHealthFactor(address user) view returns (uint256)'
];
```

---

## Complete Usage Example

```javascript
const { ethers } = require('ethers');
const axios = require('axios');

const BASE_URL = 'https://app.strato.nexus/api';
const RPC_URL = 'https://app.strato.nexus/strato-api/eth/v1.2';

// Step 1: Get contract addresses dynamically
async function getContractAddresses(accessToken) {
  const [lending, cdp] = await Promise.all([
    axios.get(`${BASE_URL}/lending/registry`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    }),
    axios.get(`${BASE_URL}/cdp/registry`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    })
  ]);

  return {
    lendingPool: lending.data.lendingPool.address,
    collateralVault: lending.data.collateralVault.address,
    cdpEngine: cdp.data.cdpEngine.address,
    usdst: cdp.data.usdst
  };
}

// Step 2: Setup provider and wallet
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Step 3: Get addresses and create contract instance
const addresses = await getContractAddresses(accessToken);

const lendingPool = new ethers.Contract(
  addresses.lendingPool,
  [
    'function borrow(address asset, uint256 amount) returns (bool)',
    'function getHealthFactor(address user) view returns (uint256)'
  ],
  wallet
);

// Step 4: Interact with contract
const tx = await lendingPool.borrow(
  addresses.usdst,
  ethers.parseEther('1000')
);
await tx.wait();

console.log('Borrowed 1000 USDST');
console.log('Transaction:', tx.hash);
```

---

## Security Notes

### Official Sources Only

**Always verify addresses from official sources:**

- ✅ Official docs: [docs.strato.nexus](https://docs.strato.nexus)
- ✅ GitHub: [github.com/blockapps](https://github.com/blockapps)
- ✅ Block explorer: [explorer.strato.nexus](https://explorer.strato.nexus)

### Never Trust

**Do NOT trust addresses from:**

- ❌ Random websites
- ❌ Telegram or social media DMs
- ❌ Unverified sources
- ❌ Social media posts

### Verify on Explorer

Before using any contract:

1. Check it's verified on explorer
2. Read the source code
3. Confirm it matches expected functionality
4. Check deployment date and deployer

---

## Contract Upgrades

**Important:** Some contracts are upgradeable (proxy pattern).

### Check Current Implementation

```javascript
// For proxy contracts
const proxyABI = [
  'function implementation() view returns (address)'
];

const proxy = new ethers.Contract(PROXY_ADDRESS, proxyABI, provider);
const implAddress = await proxy.implementation();
console.log('Current implementation:', implAddress);
```

### Subscribe to Upgrade Notifications

- **Documentation**: [docs.strato.nexus](https://docs.strato.nexus)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Support**: [support.blockapps.net](https://support.blockapps.net)

---

## Emergency Contacts

### Security Issues

If you discover a security vulnerability:

- **Email**: security@blockapps.net

**Do NOT:**

- Publicly disclose vulnerabilities
- Exploit them
- Discuss in public channels

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2024-01 | v1.0 | Initial mainnet deployment |
| 2024-03 | v1.1 | Added rewards system |
| 2024-06 | v1.2 | CDP integration |
| 2024-09 | v1.3 | Bridge launch |

---

## All Contract Discovery Methods

### Lending Contracts

```javascript
// Get from /lending/registry endpoint
const response = await axios.get(`${BASE_URL}/lending/registry`, {
  headers: { 'Authorization': `Bearer ${accessToken}` }
});

// Available addresses:
// - lendingPool.address
// - collateralVault.address  
// - liquidityPool.address
// - oracle.address (priceOracle)
```

### CDP Contracts

```javascript
// Get from /cdp/registry endpoint
const response = await axios.get(`${BASE_URL}/cdp/registry`, {
  headers: { 'Authorization': `Bearer ${accessToken}` }
});

// Available addresses:
// - cdpEngine.address
// - cdpVault.address
// - usdst (USDST token address)
// - tokenFactory
// - feeCollector
```

### Token Addresses

```javascript
// Get all tokens with their addresses
const response = await axios.get(`${BASE_URL}/tokens/v2`, {
  params: { status: 'neq.2', limit: 50 },
  headers: { 'Authorization': `Bearer ${accessToken}` }
});

const tokens = response.data.map(token => ({
  symbol: token._symbol,
  address: token.address,
  decimals: token.customDecimals
}));

// Find specific token
const usdst = tokens.find(t => t.symbol === 'USDST');
const weth = tokens.find(t => t.symbol === 'WETH');
```

### Swap Pool Addresses

```javascript
// Get all AMM pools
const response = await axios.get(`${BASE_URL}/swap-pools`, {
  headers: { 'Authorization': `Bearer ${accessToken}` }
});

// Available data:
// - poolAddress
// - tokenA, tokenB (token addresses)
// - reserves (tokenABalance, tokenBBalance)
// - lpToken (LP token address)
```

---

## Next Steps

- **[Quick Start](quickstart.md)** - Start building
- **[Quick Reference](quick-reference.md)** - Common operations
- **[Integration Guide](integration.md)** - Complete tutorial
- **[E2E Examples](e2e.md)** - Full workflows

### Get Help

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)

---

> **Note:** Contact the STRATO team to get the actual deployed addresses. This page will be updated with real addresses once available.

