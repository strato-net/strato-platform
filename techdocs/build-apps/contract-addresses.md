# Contract Reference

Find deployed contracts and addresses for your STRATO deployment.

!!! note "About Endpoints"
    All examples use `localhost` for local development.
    
    **For production, use public endpoints:**
    - Mainnet: `https://app.strato.nexus`
    - Testnet: `https://buildtest.mercata-testnet.blockapps.net`
    
    **Contract addresses are the same across all deployments** (query from registries)

!!! tip "Query Dynamically"
    Contract addresses are **not hardcoded** in documentation. Always fetch them dynamically from Cirrus or registries to ensure accuracy.

---

## How to Get Contract Addresses

### Method 1: Query Cirrus (Recommended)

Use Cirrus to query all deployed contracts:

```typescript
import { cirrus } from './config';

// Get all contracts
async function getAllContracts(accessToken: string) {
  const response = await cirrus.get('/Contract', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      select: 'address,name',
      limit: 100
    }
  });
  
  return response.data;
}

// Get specific contract by name
async function getContractByName(accessToken: string, name: string) {
  const response = await cirrus.get('/Contract', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      name: `eq.${name}`,
      select: 'address'
    }
  });
  
  return response.data[0]?.address;
}

// Example usage
const accessToken = await getAccessToken();
const contracts = await getAllContracts(accessToken);
console.log('Deployed contracts:', contracts);
```

### Method 2: Use Registries

Contract registries have **fixed addresses** and contain references to other contracts:

```typescript
// Fixed registry addresses (same across all STRATO deployments)
const REGISTRIES = {
  LENDING_REGISTRY: '0000000000000000000000000000000000001007',
  CDP_REGISTRY: '0000000000000000000000000000000000001012',
  POOL_FACTORY: '000000000000000000000000000000000000100a',
  TOKEN_FACTORY: '000000000000000000000000000000000000100b',
  ADMIN_REGISTRY: '000000000000000000000000000000000000100c',
  MERCATA_BRIDGE: '0000000000000000000000000000000000001008',
  POOL_CONFIGURATOR: '0000000000000000000000000000000000001006',
  VOUCHER: '000000000000000000000000000000000000100e',
  REWARDS_CHEF: '000000000000000000000000000000000000101f',
};

// Get lending contracts from registry
async function getLendingContracts(accessToken: string) {
  const response = await cirrus.get('/LendingRegistry', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      address: `eq.${REGISTRIES.LENDING_REGISTRY}`,
      select: 'lendingPool,collateralVault,priceOracle,liquidityPool'
    }
  });
  
  return response.data[0];
}

// Get CDP contracts from registry
async function getCDPContracts(accessToken: string) {
  const response = await cirrus.get('/CDPRegistry', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      address: `eq.${REGISTRIES.CDP_REGISTRY}`,
      select: 'cdpEngine,cdpVault,usdst'
    }
  });
  
  return response.data[0];
}

// Example usage
const lending = await getLendingContracts(accessToken);
console.log('Lending Pool:', lending.lendingPool);
console.log('Collateral Vault:', lending.collateralVault);
console.log('Price Oracle:', lending.priceOracle);

const cdp = await getCDPContracts(accessToken);
console.log('CDP Engine:', cdp.cdpEngine);
console.log('CDP Vault:', cdp.cdpVault);
console.log('USDST Token:', cdp.usdst);
```

### Method 3: Environment Variables

For backend apps, store addresses in environment variables:

```bash
# .env
LENDING_REGISTRY=0000000000000000000000000000000000001007
CDP_REGISTRY=0000000000000000000000000000000000001012
POOL_FACTORY=000000000000000000000000000000000000100a
TOKEN_FACTORY=000000000000000000000000000000000000100b
ADMIN_REGISTRY=000000000000000000000000000000000000100c
MERCATA_BRIDGE=0000000000000000000000000000000000001008
VOUCHER_CONTRACT_ADDRESS=000000000000000000000000000000000000100e
REWARDS_CHEF=000000000000000000000000000000000000101f
```

```typescript
// src/config.ts
export const CONTRACTS = {
  LENDING_REGISTRY: process.env.LENDING_REGISTRY || '0000000000000000000000000000000000001007',
  CDP_REGISTRY: process.env.CDP_REGISTRY || '0000000000000000000000000000000000001012',
  // ... etc
};
```

---

## Contract Verification

All contracts are verified on the STRATO Management Dashboard (SMD). You can:

1. **View source code** - See contract implementation
2. **Read contract** - Call view functions
3. **Write contract** - Execute transactions
4. **View events** - Monitor contract activity

**Access SMD (Block Explorer):**

```
# Local development
http://localhost:8080/smd/

# Production
https://app.strato.nexus/smd/  (mainnet)
https://buildtest.mercata-testnet.blockapps.net/smd/  (testnet)

# View specific contract
http://localhost:8080/smd/address/0x.../contracts
```

---

## Complete Example: Get All Addresses

```typescript
import { cirrus } from './config';
import { getAccessToken } from './auth';

interface ContractAddresses {
  // Core registries
  lendingRegistry: string;
  cdpRegistry: string;
  poolFactory: string;
  tokenFactory: string;
  adminRegistry: string;
  bridge: string;
  
  // Lending contracts
  lendingPool?: string;
  collateralVault?: string;
  priceOracle?: string;
  
  // CDP contracts
  cdpEngine?: string;
  cdpVault?: string;
  usdst?: string;
  
  // Tokens
  tokens?: Array<{ address: string; name: string; symbol: string }>;
}

async function getAllContractAddresses(): Promise<ContractAddresses> {
  const accessToken = await getAccessToken();
  
  // Fixed registry addresses
  const REGISTRIES = {
    lendingRegistry: '0000000000000000000000000000000000001007',
    cdpRegistry: '0000000000000000000000000000000000001012',
    poolFactory: '000000000000000000000000000000000000100a',
    tokenFactory: '000000000000000000000000000000000000100b',
    adminRegistry: '000000000000000000000000000000000000100c',
    bridge: '0000000000000000000000000000000000001008',
  };
  
  // Query lending contracts
  const lendingResponse = await cirrus.get('/LendingRegistry', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      address: `eq.${REGISTRIES.lendingRegistry}`,
      select: 'lendingPool,collateralVault,priceOracle'
    }
  });
  
  // Query CDP contracts
  const cdpResponse = await cirrus.get('/CDPRegistry', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      address: `eq.${REGISTRIES.cdpRegistry}`,
      select: 'cdpEngine,cdpVault,usdst'
    }
  });
  
  // Query all tokens
  const tokensResponse = await cirrus.get('/Token', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      select: 'address,_name,_symbol',
      limit: 100
    }
  });
  
  return {
    ...REGISTRIES,
    ...lendingResponse.data[0],
    ...cdpResponse.data[0],
    tokens: tokensResponse.data,
  };
}

// Usage
const addresses = await getAllContractAddresses();
console.log('All contract addresses:', addresses);
```

---

## Network Configuration

Add STRATO to wallet or app:

```typescript
const STRATO_NETWORK = {
  chainId: '0x...', // Get from your deployment
  chainName: 'STRATO',
  // For local dev:
  rpcUrls: ['http://localhost:8080/strato-api/eth/v1.2'],
  blockExplorerUrls: ['http://localhost:8080/smd'],
  
  // For production (replace with):
  // rpcUrls: ['https://app.strato.nexus/strato-api/eth/v1.2'],  // mainnet
  // blockExplorerUrls: ['https://app.strato.nexus/smd'],  // mainnet
  nativeCurrency: {
    name: 'USDST',
    symbol: 'USDST',
    decimals: 18
  }
};
```

---

## Common Contract Patterns

### Pattern: Get Token Address by Symbol

```typescript
async function getTokenBySymbol(accessToken: string, symbol: string) {
  const response = await cirrus.get('/Token', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      _symbol: `eq.${symbol}`,
      select: 'address,_name,_symbol'
    }
  });
  
  return response.data[0];
}

// Example
const ethst = await getTokenBySymbol(accessToken, 'ETHST');
console.log('ETHST address:', ethst.address);
```

### Pattern: Get All Pools

```typescript
async function getAllPools(accessToken: string) {
  const POOL_FACTORY = '000000000000000000000000000000000000100a';
  
  const response = await cirrus.get('/Pool', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      select: 'address,_token0,_token1,_reserve0,_reserve1',
      limit: 100
    }
  });
  
  return response.data;
}
```

### Pattern: Get User Collateral

```typescript
async function getUserCollateral(
  accessToken: string,
  collateralVaultAddress: string,
  userAddress: string
) {
  const response = await cirrus.get('/CollateralVault-userCollaterals', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      address: `eq.${collateralVaultAddress}`,
      key: `eq.${userAddress}`,
      select: 'key2,value::text'
    }
  });
  
  return response.data;
}
```

---

## Security Best Practices

### Always Verify

- ✅ Block explorer (SMD): 
  - Local: `http://localhost:8080/smd/`
  - Mainnet: `https://app.strato.nexus/smd/`
  - Testnet: `https://buildtest.mercata-testnet.blockapps.net/smd/`
- ✅ Query Cirrus for contract code
- ✅ Check contract name matches expected

### Never Trust

- ❌ Hardcoded addresses from unknown sources
- ❌ Addresses from untrusted APIs
- ❌ Addresses without verification

### Verify on SMD (Block Explorer)

Before using any contract:

1. Check it's verified on SMD: `{your-strato-url}/smd/`
2. Read the source code
3. Confirm it matches expected functionality

---

## Reference Implementation

The **mercata backend** shows how to manage contract addresses:

- **Config** - `mercata/backend/src/config/config.ts` - Environment variables
- **Constants** - `mercata/backend/src/config/constants.ts` - Contract definitions
- **Helpers** - `mercata/backend/src/api/helpers/` - Registry queries

---

## Next Steps

- **[Quick Start](quickstart.md)** - Build your first transaction
- **[API Integration](integration.md)** - Complete integration guide
- **[Quick Reference](quick-reference.md)** - Code snippets
