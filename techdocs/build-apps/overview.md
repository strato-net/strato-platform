# Building Apps on STRATO

Welcome! This guide helps you build external applications that integrate with your STRATO deployment.

## What is STRATO?

**STRATO** is an EVM-compatible blockchain platform optimized for DeFi with:

- **Fast finality** (~1-2 second block times)
- **Low fees** (< $0.10 per transaction)
- **EVM compatibility** (Solidity smart contracts)
- **Rich API layer** (REST + JSON-RPC)
- **Indexed data** (Cirrus for fast queries)

**Why build apps on STRATO:**

- **Lower costs** - Cheaper than Ethereum mainnet
- **Faster UX** - ~1-2 second finality
- **Full-stack APIs** - No need for own indexer
- **Active DeFi** - Lending, swaps, CDP ecosystem

## Important: STRATO Uses REST APIs (Not JSON-RPC)

**STRATO is a public blockchain**, but it uses **REST APIs** instead of JSON-RPC like Ethereum.

**Key differences from Ethereum:**

- ❌ **No JSON-RPC** - `ethers.js`, `web3.js` won't work
- ✅ **REST APIs** - Use HTTP requests to STRATO's native APIs
- ✅ **Public endpoints** - Access STRATO without deploying your own node
- ✅ **Built-in indexer** - Query blockchain data directly (no need for The Graph)

### Connection Options

**Option 1: Use Public STRATO Endpoints (Recommended)**

Connect to the public STRATO network via REST APIs:

- **Mainnet**: `https://app.strato.nexus/api`
- **Testnet**: `https://buildtest.mercata-testnet.blockapps.net/api`

**Option 2: Deploy Your Own Node (Optional)**

You can also run your own STRATO instance for local development:

- **Local development**: `http://localhost:8080`
- See [Setup Guide](../contribute/setup.md) for installation

!!! tip "Most Developers Use Public Endpoints"
    Unlike Ethereum where you need Infura/Alchemy, STRATO provides public REST endpoints. You don't need to deploy your own node unless you want local development.

---

## How to Build Apps on STRATO

!!! danger "Important: ethers.js Does NOT Work"
    Unlike Ethereum, you CANNOT use ethers.js or web3.js directly with STRATO.
    
    **You must use STRATO's REST APIs.**

### The STRATO Stack

**STRATO provides multiple APIs:**

| API | Endpoint | Purpose |
|-----|----------|---------|
| **STRATO API** | `/strato/v2.3` | Transaction submission, account management |
| **Cirrus** | `/cirrus/search` | Indexed blockchain data (PostgreSQL) |
| **BLOC** | `/bloc/v2.2` | Block and transaction queries |
| **ETH JSON-RPC** | `/strato-api/eth/v1.2` | Limited Ethereum compatibility |

!!! tip "Reference Implementation"
    The **mercata** app (in `mercata/` folder) is the complete reference implementation showing how to build apps on STRATO.

---

## Prerequisites

### 1. STRATO Access

You need access to a STRATO endpoint to build apps.

**Option 1: Use Public Endpoints (Recommended)**

- **Mainnet**: `https://app.strato.nexus`
- **Testnet**: `https://buildtest.mercata-testnet.blockapps.net`

No setup required - just start building!

**Option 2: Local Development (Optional)**

For local testing, you can run STRATO on your machine:

```bash
cd strato-platform
./start my_node_name
```

Your local instance will be at: `http://localhost:8080`

See [Setup Guide](../contribute/setup.md) for installation instructions.

!!! tip "Examples Use Localhost"
    All code examples use `http://localhost:8080` for local development. For production, replace with public endpoints (`https://app.strato.nexus` for mainnet).

### 2. Technical Requirements (for Your App)

**You should have:**

- **Node.js 18+** - For backend development
- **TypeScript** - Recommended for type safety
- **HTTP client** - axios, fetch, or similar
- **OAuth 2.0** - For authentication

**Not needed:**

- ~~ethers.js~~ - Does not work with STRATO
- ~~web3.js~~ - Does not work with STRATO

---

## Quick Start

!!! warning "Prerequisites"
    Before following this guide, make sure:
    
    1. ✅ STRATO is deployed (see [Setup Guide](../contribute/setup.md))
    2. ✅ Your STRATO node is running
    3. ✅ You can access your STRATO instance

### 1. Set Up Your App Environment

```bash
# Create your app project (separate from STRATO)
mkdir my-strato-app
cd my-strato-app
npm init -y

# Install dependencies
npm install axios dotenv
```

Create `.env`:

```bash
# Your STRATO deployment
NODE_URL=http://localhost:8080

# OAuth credentials (get from your STRATO deployment)
OAUTH_CLIENT_ID=your_client_id
OAUTH_CLIENT_SECRET=your_client_secret
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata
```

### 2. Create API Client

```typescript
// src/config.ts
import axios, { AxiosInstance } from 'axios';

const NODE_URL = process.env.NODE_URL || 'http://localhost:8080';

const createApiClient = (baseURL: string): AxiosInstance => {
  return axios.create({
    baseURL,
    headers: { 'Content-Type': 'application/json' },
    timeout: 60_000,
  });
};

// STRATO API clients
export const strato = createApiClient(`${NODE_URL}/strato/v2.3`);
export const cirrus = createApiClient(`${NODE_URL}/cirrus/search`);
export const bloc = createApiClient(`${NODE_URL}/bloc/v2.2`);
```

### 3. Get OAuth Token

```typescript
// src/auth.ts
import axios from 'axios';

const OAUTH_DISCOVERY_URL = process.env.OAUTH_DISCOVERY_URL!;
const CLIENT_ID = process.env.OAUTH_CLIENT_ID!;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET!;

let tokenEndpoint: string;

// Initialize: fetch OAuth configuration
export async function initAuth() {
  const { data } = await axios.get(`${OAUTH_DISCOVERY_URL}/.well-known/openid-configuration`);
  tokenEndpoint = data.token_endpoint;
}

// Get service token (for backend apps)
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

### 4. Build Your First Transaction

```typescript
// src/transactions.ts
import { strato, cirrus, bloc } from './config';

interface FunctionInput {
  contractName: string;
  contractAddress: string;
  method: string;
  args: Record<string, any>;
}

// Build transaction
export async function buildFunctionTx(inputs: FunctionInput | FunctionInput[]) {
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

// Submit transaction
export async function submitTransaction(accessToken: string, tx: any) {
  const response = await strato.post(
    '/transaction/parallel?resolve=true',
    tx,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  
  return response.data;
}

// Query data from Cirrus
export async function queryTokens(accessToken: string) {
  const response = await cirrus.get('/Token', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      select: 'address,_name,_symbol,_totalSupply::text',
      limit: 10
    }
  });
  
  return response.data;
}
```

### 5. Complete Example: Transfer Tokens

```typescript
// src/example.ts
import { initAuth, getAccessToken } from './auth';
import { buildFunctionTx, submitTransaction, queryTokens } from './transactions';

async function transferTokens() {
  // 1. Initialize auth
  await initAuth();
  const accessToken = await getAccessToken();
  
  // 2. Query available tokens
  const tokens = await queryTokens(accessToken);
  console.log('Available tokens:', tokens);
  
  // 3. Build transfer transaction
  const tx = await buildFunctionTx({
    contractName: 'Token',
    contractAddress: '0x1234...', // Your token address
    method: 'transfer',
    args: {
      to: '0x5678...',
      value: '1000000000000000000' // 1 token (18 decimals)
    }
  });
  
  // 4. Submit transaction
  const result = await submitTransaction(accessToken, tx);
  console.log('Transaction result:', result);
}

transferTokens().catch(console.error);
```

---

## Core Integration Guide

### Complete End-to-End Integration

For a comprehensive walkthrough with code examples for all operations:

→ **[API Integration Guide](integration.md)**

**Covers:**

- Authentication and session management
- Token queries and balances
- Bridge operations
- Swap execution
- Lending pool integration
- CDP vault management
- Rewards tracking

---

## Key Concepts

### Transaction Flow

```
1. Get OAuth token
2. Build transaction using buildFunctionTx()
3. Submit to /strato/v2.3/transaction/parallel
4. Wait for confirmation
5. Verify success
```

### Querying Data

**Use Cirrus (indexed PostgreSQL) for fast queries:**

```typescript
// Get all tokens
const tokens = await cirrus.get('/Token', {
  headers: { Authorization: `Bearer ${token}` }
});

// Get user balance
const balance = await cirrus.get('/Token-_balances', {
  headers: { Authorization: `Bearer ${token}` },
  params: {
    address: 'eq.0x...', // Token address
    key: 'eq.0x...',     // User address
    select: 'value::text'
  }
});
```

### Error Handling

```typescript
try {
  const result = await submitTransaction(token, tx);
} catch (error) {
  if (error.response?.status === 401) {
    // Token expired - refresh
  } else if (error.response?.status === 400) {
    // Transaction failed - check error message
    console.error('Transaction error:', error.response.data);
  }
}
```

---

## Common Integration Patterns

### Pattern 1: Backend with STRATO APIs

**Architecture:**
```
Frontend → Your Backend → STRATO APIs → Blockchain
```

**Best for:**
- Complex business logic
- Multi-user applications
- Server-side authentication

**Example: mercata app** (`mercata/backend/`)

### Pattern 2: Microservice Integration

**Architecture:**
```
Your Service → STRATO APIs → Blockchain
```

**Best for:**
- Event-driven workflows
- Automated processes
- Backend services

---

## Resources

### Documentation

- **[API Integration Guide](integration.md)** - Complete walkthrough
- **[Quick Reference](quick-reference.md)** - Code snippets
- **[E2E Examples](e2e.md)** - Full example flows
- **[Contract Addresses](contract-addresses.md)** - Find deployed contracts

### Reference Implementation

- **mercata app** - `strato-platform/mercata/` folder
  - **Backend** - `mercata/backend/` - Shows STRATO API usage
  - **Frontend** - `mercata/ui/` - React app
  - **Contracts** - `mercata/contracts/` - Solidity contracts

### Support

We're here to help! Reach out through any of these channels:

- **Documentation**: [docs.strato.nexus](https://docs.strato.nexus)
- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)

---

## Next Steps

### Ready to Build?

→ **[Quick Start Guide](quickstart.md)**

Complete walkthrough with code examples for auth, transactions, and queries.

### Need Reference Docs?

- **[API Integration Guide](integration.md)** - Complete integration walkthrough
- **[Interactive API (Swagger)](../reference/interactive-api.md)** - Explore the API
- **[Quick Reference](quick-reference.md)** - Code snippets for common operations
