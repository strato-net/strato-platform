# API Cheat Sheet

Quick reference for common STRATO operations using REST APIs.

!!! danger "Important: ethers.js Does NOT Work"
    **You CANNOT use ethers.js or web3.js with STRATO.**
    
    Use STRATO REST APIs: `/strato/v2.3`, `/cirrus/search`, `/bloc/v2.2`

!!! note "About Endpoints"
    All examples use `localhost` for local development.
    
    **For production, use public endpoints:**
    - Mainnet: `https://app.strato.nexus`
    - Testnet: `https://app.testnet.strato.nexus`
    
    **Optional:** [Local setup guide](../contribute/setup.md)

---

## Setup

```typescript
import axios, { AxiosInstance } from 'axios';

// For local dev:
const NODE_URL = 'http://localhost:8080';

// For production (replace with):
// const NODE_URL = 'https://app.strato.nexus';  // mainnet
// const NODE_URL = 'https://app.testnet.strato.nexus';  // testnet

function createApiClient(baseURL: string): AxiosInstance {
  return axios.create({
    baseURL,
    headers: { 'Content-Type': 'application/json' },
    timeout: 60_000,
  });
}

// API clients
export const strato = createApiClient(`${NODE_URL}/strato/v2.3`);
export const cirrus = createApiClient(`${NODE_URL}/cirrus/search`);
export const bloc = createApiClient(`${NODE_URL}/bloc/v2.2`);
```

---

## Authentication

### Get OAuth Token

```typescript
import axios from 'axios';

const OAUTH_DISCOVERY_URL = process.env.OAUTH_DISCOVERY_URL!;
const CLIENT_ID = process.env.OAUTH_CLIENT_ID!;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET!;

let tokenEndpoint: string;

export async function initAuth() {
  const { data } = await axios.get(
    `${OAUTH_DISCOVERY_URL}/.well-known/openid-configuration`
  );
  tokenEndpoint = data.token_endpoint;
}

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

## Transaction Builder

### Build Function Transaction

```typescript
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
```

### Submit Transaction

```typescript
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
```

---

## Token Operations

### Transfer Tokens

```typescript
const tx = buildFunctionTx({
  contractName: 'Token',
  contractAddress: '0x...',
  method: 'transfer',
  args: {
    to: '0x...',
    value: '1000000000000000000' // 1 token (18 decimals)
  }
});

const result = await submitTransaction(accessToken, tx);
```

### Approve Tokens

```typescript
const tx = buildFunctionTx({
  contractName: 'Token',
  contractAddress: TOKEN_ADDRESS,
  method: 'approve',
  args: {
    spender: SPENDER_ADDRESS,
    value: '1000000000000000000'
  }
});

await submitTransaction(accessToken, tx);
```

### Query Token Balance

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

### Get All Tokens

```typescript
async function getAllTokens(accessToken: string) {
  const response = await cirrus.get('/Token', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      select: 'address,_name,_symbol,_totalSupply::text',
      limit: 100
    }
  });
  
  return response.data;
}
```

---

## Lending Operations

### Supply Collateral

```typescript
// Multi-step: Approve + Supply
const tx = buildFunctionTx([
  {
    contractName: 'Token',
    contractAddress: ETHST_TOKEN,
    method: 'approve',
    args: {
      spender: LENDING_POOL,
      value: amount
    }
  },
  {
    contractName: 'LendingPool',
    contractAddress: LENDING_POOL,
    method: 'supplyCollateral',
    args: {
      asset: ETHST_TOKEN,
      amount: amount
    }
  }
]);

await submitTransaction(accessToken, tx);
```

### Borrow

```typescript
const tx = buildFunctionTx({
  contractName: 'LendingPool',
  contractAddress: LENDING_POOL,
  method: 'borrow',
  args: {
    asset: USDST_TOKEN,
    amount: '1000000000000000000000' // 1000 USDST
  }
});

await submitTransaction(accessToken, tx);
```

### Repay

```typescript
const tx = buildFunctionTx([
  {
    contractName: 'Token',
    contractAddress: USDST_TOKEN,
    method: 'approve',
    args: {
      spender: LENDING_POOL,
      value: amount
    }
  },
  {
    contractName: 'LendingPool',
    contractAddress: LENDING_POOL,
    method: 'repay',
    args: {
      asset: USDST_TOKEN,
      amount: amount
    }
  }
]);

await submitTransaction(accessToken, tx);
```

### Query User Collateral

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

## CDP Operations

### Deposit Collateral to CDP

```typescript
const tx = buildFunctionTx([
  {
    contractName: 'Token',
    contractAddress: ETHST_TOKEN,
    method: 'approve',
    args: {
      spender: CDP_ENGINE,
      value: amount
    }
  },
  {
    contractName: 'CDPEngine',
    contractAddress: CDP_ENGINE,
    method: 'deposit',
    args: {
      collateralType: ETHST_TOKEN,
      amount: amount
    }
  }
]);

await submitTransaction(accessToken, tx);
```

### Mint USDST

```typescript
const tx = buildFunctionTx({
  contractName: 'CDPEngine',
  contractAddress: CDP_ENGINE,
  method: 'mint',
  args: {
    collateralType: ETHST_TOKEN,
    amount: '1000000000000000000000' // 1000 USDST
  }
});

await submitTransaction(accessToken, tx);
```

### Repay CDP Debt

```typescript
const tx = buildFunctionTx([
  {
    contractName: 'Token',
    contractAddress: USDST_TOKEN,
    method: 'approve',
    args: {
      spender: CDP_ENGINE,
      value: amount
    }
  },
  {
    contractName: 'CDPEngine',
    contractAddress: CDP_ENGINE,
    method: 'repay',
    args: {
      collateralType: ETHST_TOKEN,
      amount: amount
    }
  }
]);

await submitTransaction(accessToken, tx);
```

---

## Swap Operations

### Swap Tokens

```typescript
const tx = buildFunctionTx([
  {
    contractName: 'Token',
    contractAddress: TOKEN_IN,
    method: 'approve',
    args: {
      spender: ROUTER,
      value: amountIn
    }
  },
  {
    contractName: 'Router',
    contractAddress: ROUTER,
    method: 'swapExactTokensForTokens',
    args: {
      amountIn: amountIn,
      amountOutMin: amountOutMin,
      path: [TOKEN_IN, TOKEN_OUT],
      to: userAddress,
      deadline: Math.floor(Date.now() / 1000) + 1200 // 20 minutes
    }
  }
]);

await submitTransaction(accessToken, tx);
```

### Query Pool Reserves

```typescript
async function getPoolReserves(
  accessToken: string,
  poolAddress: string
) {
  const response = await cirrus.get('/Pool', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      address: `eq.${poolAddress}`,
      select: '_token0,_token1,_reserve0::text,_reserve1::text'
    }
  });
  
  return response.data[0];
}
```

---

## Liquidity Operations

### Add Liquidity

```typescript
const tx = buildFunctionTx([
  {
    contractName: 'Token',
    contractAddress: TOKEN_A,
    method: 'approve',
    args: {
      spender: ROUTER,
      value: amountA
    }
  },
  {
    contractName: 'Token',
    contractAddress: TOKEN_B,
    method: 'approve',
    args: {
      spender: ROUTER,
      value: amountB
    }
  },
  {
    contractName: 'Router',
    contractAddress: ROUTER,
    method: 'addLiquidity',
    args: {
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      amountADesired: amountA,
      amountBDesired: amountB,
      amountAMin: amountAMin,
      amountBMin: amountBMin,
      to: userAddress,
      deadline: Math.floor(Date.now() / 1000) + 1200
    }
  }
]);

await submitTransaction(accessToken, tx);
```

### Remove Liquidity

```typescript
const tx = buildFunctionTx([
  {
    contractName: 'Pool',
    contractAddress: POOL_ADDRESS,
    method: 'approve',
    args: {
      spender: ROUTER,
      value: lpTokenAmount
    }
  },
  {
    contractName: 'Router',
    contractAddress: ROUTER,
    method: 'removeLiquidity',
    args: {
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      liquidity: lpTokenAmount,
      amountAMin: amountAMin,
      amountBMin: amountBMin,
      to: userAddress,
      deadline: Math.floor(Date.now() / 1000) + 1200
    }
  }
]);

await submitTransaction(accessToken, tx);
```

---

## Bridge Operations

### Request Withdrawal

```typescript
const tx = buildFunctionTx([
  {
    contractName: 'Token',
    contractAddress: STRATO_TOKEN,
    method: 'approve',
    args: {
      spender: BRIDGE,
      value: amount
    }
  },
  {
    contractName: 'MercataBridge',
    contractAddress: BRIDGE,
    method: 'requestWithdrawal',
    args: {
      externalChainId: '1', // Ethereum mainnet
      externalRecipient: ethereumAddress,
      externalToken: externalTokenAddress,
      stratoTokenAmount: amount
    }
  }
]);

await submitTransaction(accessToken, tx);
```

### Query Bridge Transactions

```typescript
async function getBridgeTransactions(
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

## Rewards Operations

### Claim Rewards

```typescript
const tx = buildFunctionTx({
  contractName: 'Rewards',
  contractAddress: REWARDS_ADDRESS,
  method: 'claimRewards',
  args: {
    activityIdsToSettle: [1, 2, 3] // Activity IDs
  }
});

await submitTransaction(accessToken, tx);
```

### Query User Rewards

```typescript
async function getUserRewards(
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

## Utility Functions

### Wait for Transaction

```typescript
async function waitForTransaction(
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

### Batch Queries

```typescript
async function batchQuery(
  accessToken: string,
  queries: Array<{ table: string; params: any }>
) {
  const promises = queries.map(({ table, params }) =>
    cirrus.get(`/${table}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params
    })
  );
  
  const results = await Promise.all(promises);
  return results.map(r => r.data);
}

// Usage
const [tokens, pools, balances] = await batchQuery(accessToken, [
  { table: 'Token', params: { limit: 10 } },
  { table: 'Pool', params: { limit: 10 } },
  { table: 'Token-_balances', params: { key: `eq.${userAddress}` } }
]);
```

---

## Error Handling

### Retry with Backoff

```typescript
async function retryWithBackoff<T>(
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

// Usage
const result = await retryWithBackoff(() =>
  submitTransaction(accessToken, tx)
);
```

### Handle Common Errors

```typescript
try {
  const result = await submitTransaction(accessToken, tx);
} catch (error: any) {
  if (error.response?.status === 401) {
    // Token expired - refresh
    accessToken = await getAccessToken();
  } else if (error.response?.status === 400) {
    // Transaction failed
    console.error('Transaction error:', error.response.data);
  } else if (error.code === 'ECONNREFUSED') {
    // STRATO node not reachable
    console.error('Cannot connect to STRATO');
  }
}
```

---

## Reference Implementation

The **mercata backend** provides complete examples:

- **Transaction Builder** - `mercata/backend/src/utils/txBuilder.ts`
- **Transaction Helper** - `mercata/backend/src/utils/txHelper.ts`
- **API Clients** - `mercata/backend/src/utils/mercataApiHelper.ts`
- **Services** - `mercata/backend/src/api/services/`

---

## Next Steps

- **[Quick Start](quickstart.md)** - Build your first app
- **[API Integration](integration.md)** - Complete integration guide
- **[E2E Examples](e2e.md)** - Full example flows
