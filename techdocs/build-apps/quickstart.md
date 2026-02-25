# Developer Quick Start

Build your first app on STRATO in 10 minutes using STRATO's REST APIs.

!!! danger "Critical: ethers.js Does NOT Work"
    **You CANNOT use ethers.js or web3.js with STRATO.**
    
    You must use STRATO's REST APIs (`/strato/v2.3`, `/cirrus/search`).

!!! info "STRATO Endpoint Options"
    You can use either public STRATO endpoints or deploy your own:
    
    - **Option 1 (Recommended):** Use public endpoints
        - Mainnet: `https://app.strato.nexus/api`
        - Testnet: `https://app.testnet.strato.nexus/api`
    - **Option 2 (Optional):** Deploy locally for development
        - See [Setup Guide](../contribute/setup.md) to install
        - Run `./start my_node_name`
        - Use `http://localhost:3000/api`

---

## 1. Setup (3 minutes)

### Create Your App Project

```bash
# Create app directory (OUTSIDE strato-platform/)
mkdir my-strato-app
cd my-strato-app
npm init -y
```

### Install Dependencies

```bash
npm install axios dotenv typescript @types/node
npm install --save-dev ts-node
```

### Environment Variables

Create `.env`:

```bash
# Your STRATO deployment URL
# For local development:
NODE_URL=http://localhost:8080

# For production, use public endpoints:
# NODE_URL=https://app.strato.nexus  (mainnet)
# NODE_URL=https://app.testnet.strato.nexus  (testnet)

# OAuth credentials (required for authentication)
OAUTH_CLIENT_ID=your_client_id_here
OAUTH_CLIENT_SECRET=your_client_secret_here
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata
```

!!! tip "Endpoint Options"
    - **Local dev:** Use `http://localhost:8080` (requires [local STRATO setup](../contribute/setup.md))
    - **Production:** Use public endpoints (no local deployment needed)
        - Mainnet: `https://app.strato.nexus`
        - Testnet: `https://app.testnet.strato.nexus`

### TypeScript Configuration

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

---

## 2. Create STRATO API Client (2 minutes)

!!! note "About the Examples"
    All code examples use `localhost` for local development. For production:
    
    - Replace `http://localhost:8080` with `https://app.strato.nexus` (mainnet)
    - Or use `https://app.testnet.strato.nexus` (testnet)

Create `src/config.ts`:

```typescript
import axios, { AxiosInstance } from 'axios';

const NODE_URL = process.env.NODE_URL || 'http://localhost:8080';

// Helper to create API client with auth
function createApiClient(baseURL: string): AxiosInstance {
  return axios.create({
    baseURL,
    headers: { 'Content-Type': 'application/json' },
    timeout: 60_000,
  });
}

// STRATO API clients
export const strato = createApiClient(`${NODE_URL}/strato/v2.3`);
export const cirrus = createApiClient(`${NODE_URL}/cirrus/search`);
export const bloc = createApiClient(`${NODE_URL}/bloc/v2.2`);
```

---

## 3. Implement OAuth Authentication (2 minutes)

Create `src/auth.ts`:

```typescript
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const OAUTH_DISCOVERY_URL = process.env.OAUTH_DISCOVERY_URL!;
const CLIENT_ID = process.env.OAUTH_CLIENT_ID!;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET!;

let tokenEndpoint: string;

// Initialize OAuth configuration
export async function initAuth(): Promise<void> {
  const { data } = await axios.get(
    `${OAUTH_DISCOVERY_URL}/.well-known/openid-configuration`
  );
  tokenEndpoint = data.token_endpoint;
}

// Get access token (for backend apps)
export async function getAccessToken(): Promise<string> {
  const response = await axios.post(
    tokenEndpoint,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );
  
  return response.data.access_token;
}
```

---

## 4. Your First Transaction (3 minutes)

Create `src/example.ts`:

```typescript
import { strato, cirrus } from './config';
import { initAuth, getAccessToken } from './auth';

interface FunctionInput {
  contractName: string;
  contractAddress: string;
  method: string;
  args: Record<string, any>;
}

// Build transaction (STRATO format)
function buildFunctionTx(inputs: FunctionInput | FunctionInput[]) {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];
  
  const txs = inputArray.map(input => ({
    type: 'FUNCTION',
    payload: {
      contractName: input.contractName,
      contractAddress: input.contractAddress,
      method: input.method,
      args: input.args,
    },
  }));
  
  return {
    txs,
    txParams: {
      gasLimit: 32_100_000_000,
      gasPrice: 1,
    },
  };
}

// Submit transaction to STRATO
async function submitTransaction(accessToken: string, tx: any) {
  const response = await strato.post(
    '/transaction/parallel?resolve=true',
    tx,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  
  return response.data;
}

// Query data from Cirrus (indexed blockchain data)
async function queryTokens(accessToken: string) {
  const response = await cirrus.get('/Token', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      select: 'address,_name,_symbol',
      limit: 10
    }
  });
  
  return response.data;
}

// Example: Transfer tokens
async function transferTokens() {
  try {
    // 1. Initialize auth
    await initAuth();
    const accessToken = await getAccessToken();
    console.log('✅ Authenticated');
    
    // 2. Query available tokens
    const tokens = await queryTokens(accessToken);
    console.log('✅ Found', tokens.length, 'tokens');
    console.log('  First token:', tokens[0]);
    
    // 3. Build transfer transaction
    const tx = buildFunctionTx({
      contractName: 'Token',
      contractAddress: tokens[0].address, // Use first token
      method: 'transfer',
      args: {
        to: '0x1234567890123456789012345678901234567890',
        value: '1000000000000000000' // 1 token (18 decimals)
      }
    });
    
    console.log('✅ Transaction built');
    
    // 4. Submit transaction
    const result = await submitTransaction(accessToken, tx);
    console.log('✅ Transaction submitted');
    console.log('  Hash:', result[0].hash);
    console.log('  Status:', result[0].status);
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('  Response:', error.response.data);
    }
  }
}

// Run example
transferTokens();
```

### Run It

```bash
npx ts-node src/example.ts
```

**Expected output:**

```
✅ Authenticated
✅ Found 15 tokens
  First token: { address: '0x...', _name: 'USD Token', _symbol: 'USDST' }
✅ Transaction built
✅ Transaction submitted
  Hash: 0xabc123...
  Status: Success
```

---

## Complete Example: Supply Collateral to Lending Pool

This example shows a more complex multi-step transaction:

Create `src/lending-example.ts`:

```typescript
import { strato, cirrus } from './config';
import { initAuth, getAccessToken } from './auth';

interface FunctionInput {
  contractName: string;
  contractAddress: string;
  method: string;
  args: Record<string, any>;
}

function buildFunctionTx(inputs: FunctionInput | FunctionInput[]) {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];
  
  const txs = inputArray.map(input => ({
    type: 'FUNCTION',
    payload: {
      contractName: input.contractName,
      contractAddress: input.contractAddress,
      method: input.method,
      args: input.args,
    },
  }));
  
  return {
    txs,
    txParams: {
      gasLimit: 32_100_000_000,
      gasPrice: 1,
    },
  };
}

async function submitTransaction(accessToken: string, tx: any) {
  const response = await strato.post(
    '/transaction/parallel?resolve=true',
    tx,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  
  return response.data;
}

// Get lending pool address from registry
async function getLendingPoolAddress(accessToken: string): Promise<string> {
  const LENDING_REGISTRY = '0000000000000000000000000000000000001007';
  
  const response = await cirrus.get('/LendingRegistry', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      address: `eq.${LENDING_REGISTRY}`,
      select: 'lendingPool'
    }
  });
  
  return response.data[0].lendingPool;
}

async function supplyCollateral() {
  try {
    // 1. Auth
    await initAuth();
    const accessToken = await getAccessToken();
    console.log('✅ Authenticated');
    
    // 2. Get contract addresses
    const lendingPoolAddress = await getLendingPoolAddress(accessToken);
    const ETHST_TOKEN = '0x...'; // Get from your deployment
    
    console.log('✅ Got lending pool address:', lendingPoolAddress);
    
    // 3. Build multi-step transaction (approve + supply)
    const amount = '1000000000000000000'; // 1 ETHST
    
    const tx = buildFunctionTx([
      // Step 1: Approve
      {
        contractName: 'Token',
        contractAddress: ETHST_TOKEN,
        method: 'approve',
        args: {
          spender: lendingPoolAddress,
          value: amount
        }
      },
      // Step 2: Supply collateral
      {
        contractName: 'LendingPool',
        contractAddress: lendingPoolAddress,
        method: 'supplyCollateral',
        args: {
          asset: ETHST_TOKEN,
          amount: amount
        }
      }
    ]);
    
    console.log('✅ Built 2-step transaction (approve + supply)');
    
    // 4. Submit
    const result = await submitTransaction(accessToken, tx);
    console.log('✅ Transaction submitted');
    console.log('  Hash:', result[0].hash);
    console.log('  Status:', result[0].status);
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('  Response:', error.response.data);
    }
  }
}

supplyCollateral();
```

---

## Finding Contract Addresses

### Method 1: Query Cirrus

```typescript
// Get all deployed contracts
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
```

### Method 2: Use Registries

```typescript
// Contract registries with fixed addresses
const REGISTRIES = {
  LENDING_REGISTRY: '0000000000000000000000000000000000001007',
  CDP_REGISTRY: '0000000000000000000000000000000000001012',
  POOL_FACTORY: '000000000000000000000000000000000000100a',
  TOKEN_FACTORY: '000000000000000000000000000000000000100b',
};

// Get lending contracts
async function getLendingContracts(accessToken: string) {
  const response = await cirrus.get('/LendingRegistry', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      address: `eq.${REGISTRIES.LENDING_REGISTRY}`,
      select: 'lendingPool,collateralVault,priceOracle'
    }
  });
  
  return response.data[0];
}
```

---

## Development Checklist

Before building your app:

- [ ] You have access to a STRATO endpoint (public or local dev)
- [ ] You have OAuth credentials
- [ ] Your `.env` is configured
- [ ] You're using STRATO REST APIs (NOT ethers.js)
- [ ] You understand buildFunctionTx() pattern

---

## Common Patterns

### Pattern: Query Balance

```typescript
async function getTokenBalance(
  accessToken: string,
  tokenAddress: string,
  userAddress: string
) {
  const response = await cirrus.get('/Token-_balances', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      address: `eq.${tokenAddress}`,
      key: `eq.${userAddress}`,
      select: 'value::text'
    }
  });
  
  return BigInt(response.data[0]?.value || '0');
}
```

### Pattern: Multi-Step Transaction

```typescript
// Example: Approve + Swap
const tx = buildFunctionTx([
  {
    contractName: 'Token',
    contractAddress: TOKEN_A,
    method: 'approve',
    args: { spender: ROUTER, value: amount }
  },
  {
    contractName: 'Router',
    contractAddress: ROUTER,
    method: 'swap',
    args: { tokenIn: TOKEN_A, tokenOut: TOKEN_B, amountIn: amount }
  }
]);
```

### Pattern: Wait for Transaction

```typescript
async function waitForTransaction(accessToken: string, txHash: string) {
  while (true) {
    const response = await bloc.post(
      '/transactions/results',
      [txHash],
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    
    const result = response.data[0];
    if (result.status !== 'Pending') {
      return result;
    }
    
    // Wait 2 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
```

---

## Debugging Tips

### Enable Request Logging

```typescript
strato.interceptors.request.use(request => {
  console.log('→ Request:', request.method?.toUpperCase(), request.url);
  return request;
});

strato.interceptors.response.use(response => {
  console.log('← Response:', response.status, response.statusText);
  return response;
});
```

### Check Transaction Error

```typescript
try {
  const result = await submitTransaction(accessToken, tx);
} catch (error: any) {
  if (error.response?.status === 400) {
    console.error('Transaction failed:', error.response.data);
    // Common issues:
    // - Insufficient balance
    // - Not approved
    // - Invalid parameters
  }
}
```

---

## Next Steps

**You now understand the basics!** 🚀

- **[API Integration Guide](integration.md)** - Complete walkthrough with all operations
- **[Quick Reference](quick-reference.md)** - Code snippets for common operations
- **[E2E Examples](e2e.md)** - Full end-to-end integration examples

### Study the Reference Implementation

The **mercata app** (`strato-platform/mercata/`) is the complete reference:

- **Backend** - `mercata/backend/src/` - Shows all STRATO API patterns
- **Transaction Builder** - `mercata/backend/src/utils/txBuilder.ts`
- **Transaction Helper** - `mercata/backend/src/utils/txHelper.ts`
- **API Clients** - `mercata/backend/src/utils/mercataApiHelper.ts`
