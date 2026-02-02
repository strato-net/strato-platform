# API Integration Guide

Complete walkthrough for integrating with STRATO using REST APIs.

!!! danger "Important: ethers.js Does NOT Work"
    **You CANNOT use ethers.js or web3.js with STRATO.**
    
    Use STRATO REST APIs: `/strato/v2.3`, `/cirrus/search`, `/bloc/v2.2`

!!! note "STRATO Endpoint Options"
    All examples use `localhost` for local development.
    
    **For production, use public endpoints:**
    
    - **Mainnet:** `https://app.strato.nexus`
    - **Testnet:** `https://app.testnet.strato.nexus`
    
    **Optional local setup:** [Setup Guide](../contribute/setup.md)

---

## Overview

This guide covers end-to-end integration with STRATO, including:

- Authentication and session management
- Token queries and balances
- Bridge operations
- Swap execution
- Lending pool integration
- CDP vault management
- Rewards tracking

**STRATO API Endpoints:**

```typescript
// For local dev:
const BASE_URL = 'http://localhost:8080';

// For production (replace with):
// const BASE_URL = 'https://app.strato.nexus';  // mainnet
// const BASE_URL = 'https://app.testnet.strato.nexus';  // testnet

const STRATO_API = `${BASE_URL}/strato/v2.3`;  // transactions, keys
const CIRRUS = `${BASE_URL}/cirrus/search`;     // indexed queries
const BLOC = `${BASE_URL}/bloc/v2.2`;           // block/tx queries
```

---

## Setup

### 1. Install Dependencies

```bash
npm install axios dotenv typescript @types/node
```

### 2. Create API Clients

Create `src/config.ts`:

```typescript
import axios, { AxiosInstance } from 'axios';

const NODE_URL = process.env.NODE_URL || 'http://localhost:8080';

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

### 3. Environment Variables

Create `.env`:

```bash
NODE_URL=http://localhost:8080
OAUTH_CLIENT_ID=your_client_id
OAUTH_CLIENT_SECRET=your_client_secret
OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/mercata
```

---

## Authentication

### OAuth 2.0 Setup

Create `src/auth.ts`:

```typescript
import axios from 'axios';

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

// Refresh token (if needed)
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const response = await axios.post(
    tokenEndpoint,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
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

## Transaction Builder

Create `src/transactions.ts`:

```typescript
import { strato, bloc } from './config';

interface FunctionInput {
  contractName: string;
  contractAddress: string;
  method: string;
  args: Record<string, any>;
}

// Build transaction in STRATO format
export function buildFunctionTx(inputs: FunctionInput | FunctionInput[]) {
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

// Wait for transaction confirmation
export async function waitForTransaction(
  accessToken: string,
  txHash: string,
  timeout: number = 60000
): Promise<any> {
  const start = Date.now();
  
  while (true) {
    const response = await bloc.post(
      '/transactions/results',
      [txHash],
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    
    const result = response.data[0];
    
    if (result.status === 'Failure') {
      throw new Error(`Transaction failed: ${result.message}`);
    }
    
    if (result.status !== 'Pending') {
      return result;
    }
    
    if (Date.now() - start >= timeout) {
      throw new Error('Transaction timeout');
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
```

---

## Token Operations

### Query Tokens

```typescript
import { cirrus } from './config';

// Get all tokens
export async function getAllTokens(accessToken: string) {
  const response = await cirrus.get('/Token', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      select: 'address,_name,_symbol,_decimals,_totalSupply::text',
      limit: 100
    }
  });
  
  return response.data;
}

// Get token by symbol
export async function getTokenBySymbol(accessToken: string, symbol: string) {
  const response = await cirrus.get('/Token', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      _symbol: `eq.${symbol}`,
      select: 'address,_name,_symbol,_decimals'
    }
  });
  
  return response.data[0];
}

// Get token balance
export async function getTokenBalance(
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

### Transfer Tokens

```typescript
import { buildFunctionTx, submitTransaction } from './transactions';

export async function transferTokens(
  accessToken: string,
  tokenAddress: string,
  to: string,
  amount: string
) {
  const tx = buildFunctionTx({
    contractName: 'Token',
    contractAddress: tokenAddress,
    method: 'transfer',
    args: { to, value: amount }
  });
  
  return await submitTransaction(accessToken, tx);
}
```

---

## Bridge Operations

### Request Withdrawal

```typescript
export async function requestWithdrawal(
  accessToken: string,
  params: {
    stratoToken: string;
    stratoTokenAmount: string;
    externalChainId: string;
    externalRecipient: string;
    externalToken: string;
  }
) {
  const BRIDGE = '0000000000000000000000000000000000001008';
  
  const tx = buildFunctionTx([
    {
      contractName: 'Token',
      contractAddress: params.stratoToken,
      method: 'approve',
      args: {
        spender: BRIDGE,
        value: params.stratoTokenAmount
      }
    },
    {
      contractName: 'MercataBridge',
      contractAddress: BRIDGE,
      method: 'requestWithdrawal',
      args: {
        externalChainId: params.externalChainId,
        externalRecipient: params.externalRecipient,
        externalToken: params.externalToken,
        stratoTokenAmount: params.stratoTokenAmount
      }
    }
  ]);
  
  return await submitTransaction(accessToken, tx);
}
```

### Query Bridge Transactions

```typescript
export async function getBridgeTransactions(
  accessToken: string,
  userAddress: string
) {
  const response = await cirrus.get('/MercataBridge-Deposit', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      recipient: `eq.${userAddress}`,
      select: '*',
      order: 'timestamp.desc',
      limit: 50
    }
  });
  
  return response.data;
}
```

---

## Swap Operations

### Execute Swap

```typescript
export async function swapTokens(
  accessToken: string,
  params: {
    router: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOutMin: string;
    to: string;
  }
) {
  const tx = buildFunctionTx([
    {
      contractName: 'Token',
      contractAddress: params.tokenIn,
      method: 'approve',
      args: {
        spender: params.router,
        value: params.amountIn
      }
    },
    {
      contractName: 'Router',
      contractAddress: params.router,
      method: 'swapExactTokensForTokens',
      args: {
        amountIn: params.amountIn,
        amountOutMin: params.amountOutMin,
        path: [params.tokenIn, params.tokenOut],
        to: params.to,
        deadline: Math.floor(Date.now() / 1000) + 1200
      }
    }
  ]);
  
  return await submitTransaction(accessToken, tx);
}
```

### Query Pools

```typescript
export async function getAllPools(accessToken: string) {
  const response = await cirrus.get('/Pool', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      select: 'address,_token0,_token1,_reserve0::text,_reserve1::text',
      limit: 100
    }
  });
  
  return response.data;
}

export async function getPoolReserves(
  accessToken: string,
  poolAddress: string
) {
  const response = await cirrus.get('/Pool', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      address: `eq.${poolAddress}`,
      select: '_reserve0::text,_reserve1::text'
    }
  });
  
  return response.data[0];
}
```

---

## Lending Operations

### Supply Collateral

```typescript
export async function supplyCollateral(
  accessToken: string,
  params: {
    lendingPool: string;
    asset: string;
    amount: string;
  }
) {
  const tx = buildFunctionTx([
    {
      contractName: 'Token',
      contractAddress: params.asset,
      method: 'approve',
      args: {
        spender: params.lendingPool,
        value: params.amount
      }
    },
    {
      contractName: 'LendingPool',
      contractAddress: params.lendingPool,
      method: 'supplyCollateral',
      args: {
        asset: params.asset,
        amount: params.amount
      }
    }
  ]);
  
  return await submitTransaction(accessToken, tx);
}
```

### Borrow

```typescript
export async function borrow(
  accessToken: string,
  params: {
    lendingPool: string;
    asset: string;
    amount: string;
  }
) {
  const tx = buildFunctionTx({
    contractName: 'LendingPool',
    contractAddress: params.lendingPool,
    method: 'borrow',
    args: {
      asset: params.asset,
      amount: params.amount
    }
  });
  
  return await submitTransaction(accessToken, tx);
}
```

### Repay

```typescript
export async function repay(
  accessToken: string,
  params: {
    lendingPool: string;
    asset: string;
    amount: string;
  }
) {
  const tx = buildFunctionTx([
    {
      contractName: 'Token',
      contractAddress: params.asset,
      method: 'approve',
      args: {
        spender: params.lendingPool,
        value: params.amount
      }
    },
    {
      contractName: 'LendingPool',
      contractAddress: params.lendingPool,
      method: 'repay',
      args: {
        asset: params.asset,
        amount: params.amount
      }
    }
  ]);
  
  return await submitTransaction(accessToken, tx);
}
```

### Query User Position

```typescript
export async function getUserLendingPosition(
  accessToken: string,
  userAddress: string,
  collateralVault: string
) {
  // Get collateral
  const collateral = await cirrus.get('/CollateralVault-userCollaterals', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      address: `eq.${collateralVault}`,
      key: `eq.${userAddress}`,
      select: 'key2,value::text'
    }
  });
  
  // Get debt
  const debt = await cirrus.get('/LendingPool-userDebts', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      key: `eq.${userAddress}`,
      select: 'key2,value::text'
    }
  });
  
  return {
    collateral: collateral.data,
    debt: debt.data
  };
}
```

---

## CDP Operations

### Deposit to CDP

```typescript
export async function depositCDP(
  accessToken: string,
  params: {
    cdpEngine: string;
    collateralType: string;
    amount: string;
  }
) {
  const tx = buildFunctionTx([
    {
      contractName: 'Token',
      contractAddress: params.collateralType,
      method: 'approve',
      args: {
        spender: params.cdpEngine,
        value: params.amount
      }
    },
    {
      contractName: 'CDPEngine',
      contractAddress: params.cdpEngine,
      method: 'deposit',
      args: {
        collateralType: params.collateralType,
        amount: params.amount
      }
    }
  ]);
  
  return await submitTransaction(accessToken, tx);
}
```

### Mint USDST

```typescript
export async function mintUSDST(
  accessToken: string,
  params: {
    cdpEngine: string;
    collateralType: string;
    amount: string;
  }
) {
  const tx = buildFunctionTx({
    contractName: 'CDPEngine',
    contractAddress: params.cdpEngine,
    method: 'mint',
    args: {
      collateralType: params.collateralType,
      amount: params.amount
    }
  });
  
  return await submitTransaction(accessToken, tx);
}
```

### Query CDP Position

```typescript
export async function getUserCDPPosition(
  accessToken: string,
  userAddress: string,
  cdpVault: string
) {
  // Get collateral
  const collateral = await cirrus.get('/CDPVault-userCollaterals', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      address: `eq.${cdpVault}`,
      key: `eq.${userAddress}`,
      select: 'key2,value::text'
    }
  });
  
  // Get debt
  const debt = await cirrus.get('/CDPEngine-userDebts', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      key: `eq.${userAddress}`,
      select: 'key2,value::text'
    }
  });
  
  return {
    collateral: collateral.data,
    debt: debt.data
  };
}
```

---

## Rewards Operations

### Claim Rewards

```typescript
export async function claimRewards(
  accessToken: string,
  params: {
    rewards: string;
    activityIds: number[];
  }
) {
  const tx = buildFunctionTx({
    contractName: 'Rewards',
    contractAddress: params.rewards,
    method: 'claimRewards',
    args: {
      activityIdsToSettle: params.activityIds
    }
  });
  
  return await submitTransaction(accessToken, tx);
}
```

### Query User Rewards

```typescript
export async function getUserRewards(
  accessToken: string,
  rewardsAddress: string,
  userAddress: string
) {
  const response = await cirrus.get('/Rewards-userInfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      address: `eq.${rewardsAddress}`,
      key: `eq.${userAddress}`,
      select: '*'
    }
  });
  
  return response.data;
}
```

---

## Error Handling

### Retry Logic

```typescript
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (i === maxRetries - 1) throw error;
      
      const delay = baseDelay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}
```

### Handle Transaction Errors

```typescript
try {
  const result = await submitTransaction(accessToken, tx);
} catch (error: any) {
  if (error.response?.status === 400) {
    // Transaction failed - parse error
    console.error('Transaction failed:', error.response.data);
  } else if (error.response?.status === 401) {
    // Token expired - refresh
    accessToken = await getAccessToken();
  } else if (error.code === 'ECONNREFUSED') {
    // STRATO node not reachable
    console.error('Cannot connect to STRATO');
  }
}
```

---

## Complete Example

```typescript
import { initAuth, getAccessToken } from './auth';
import { buildFunctionTx, submitTransaction } from './transactions';
import { getAllTokens, getTokenBalance } from './tokens';

async function main() {
  // 1. Initialize
  await initAuth();
  const accessToken = await getAccessToken();
  console.log('✅ Authenticated');
  
  // 2. Query tokens
  const tokens = await getAllTokens(accessToken);
  console.log('✅ Found', tokens.length, 'tokens');
  
  // 3. Get balance
  const userAddress = '0x...';
  const ethst = tokens.find(t => t._symbol === 'ETHST');
  const balance = await getTokenBalance(accessToken, ethst.address, userAddress);
  console.log('✅ ETHST balance:', balance.toString());
  
  // 4. Transfer tokens
  const tx = buildFunctionTx({
    contractName: 'Token',
    contractAddress: ethst.address,
    method: 'transfer',
    args: {
      to: '0x...',
      value: '1000000000000000000'
    }
  });
  
  const result = await submitTransaction(accessToken, tx);
  console.log('✅ Transfer complete:', result[0].hash);
}

main().catch(console.error);
```

---

## Reference Implementation

The **mercata backend** is the complete reference:

- **Transaction Builder** - `mercata/backend/src/utils/txBuilder.ts`
- **Transaction Helper** - `mercata/backend/src/utils/txHelper.ts`
- **API Clients** - `mercata/backend/src/utils/mercataApiHelper.ts`
- **Services** - `mercata/backend/src/api/services/`
  - `tokens.service.ts` - Token operations
  - `bridge.service.ts` - Bridge operations
  - `swapping.service.ts` - Swap operations
  - `lending.service.ts` - Lending operations
  - `cdp.service.ts` - CDP operations
  - `rewards.service.ts` - Rewards operations

---

## Next Steps

- **[Quick Reference](quick-reference.md)** - Code snippets
- **[E2E Examples](e2e.md)** - Full example flows
- **[Contract Addresses](contract-addresses.md)** - Find deployed contracts
