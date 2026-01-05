# Integration Guide

Complete walkthrough: Auth → API → Bridge → Swap → Lending/CDP → Rewards

## Goal

Help an integrator build a complete STRATO integration that can:

- authenticate a user,
- read balances,
- bridge assets,
- swap assets,
- manage lending + CDP positions,
- track/claim rewards.

## Prerequisites

- Node.js 18+ (or your preferred language with HTTP client)
- STRATO account (create at [https://app.strato.nexus/](https://app.strato.nexus/))
- API base URL: 

  - Production: `https://app.strato.nexus/api`
  - Testnet: `https://buildtest.mercata-testnet.blockapps.net/api`

## Step 1: Authentication & Session Setup

!!! warning "Keycloak OAuth Required"
    STRATO uses **Keycloak** for authentication. There are no `/auth/login` or `/auth/refresh` endpoints. You must use OAuth 2.0 with Keycloak.

### 1.1 Get OAuth Token

```javascript
const axios = require('axios');

const BASE_URL = 'https://buildtest.mercata-testnet.blockapps.net/api';
const KEYCLOAK_URL = 'https://keycloak.blockapps.net/auth/realms/mercata';

// For service accounts (backend integrations)
async function getServiceToken() {
  const response = await axios.post(
    `${KEYCLOAK_URL}/protocol/openid-connect/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.OAUTH_CLIENT_ID,
      client_secret: process.env.OAUTH_CLIENT_SECRET
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );

  const { access_token, expires_in } = response.data;
  return { accessToken: access_token, expiresIn: expires_in };
}

// For interactive users (browser/frontend)
// Token is automatically managed after user logs in at app.strato.nexus
// Access it from: localStorage.getItem('access_token')

// Usage
const { accessToken } = await getServiceToken();
```

### 1.2 Create Authenticated Client

```javascript
class StratoClient {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;

    this.client = axios.create({
      baseURL: BASE_URL,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Auto-refresh on 401
    this.client.interceptors.request.use(async (config) => {
      // Ensure valid token
      await this.ensureValidToken();
      config.headers['Authorization'] = `Bearer ${this.accessToken}`;
      return config;
    });

    this.client.interceptors.response.use(
      response => response,
      async error => {
        if (error.response?.status === 401) {
          // Re-authenticate and retry
          await this.authenticate();
          error.config.headers['Authorization'] = `Bearer ${this.accessToken}`;
          return this.client.request(error.config);
        }
        throw error;
      }
    );
  }

  async authenticate() {
    const { accessToken, expiresIn } = await getServiceToken();
    this.accessToken = accessToken;
    this.tokenExpiry = Date.now() + (expiresIn * 1000);
  }

  async ensureValidToken() {
    // Refresh if token expires in less than 5 minutes
    if (!this.accessToken || Date.now() > this.tokenExpiry - 300000) {
      await this.authenticate();
    }
  }
}

const client = new StratoClient();
await client.authenticate();
```

### 1.3 Verify Authentication

```javascript
async function getAccount() {
  const response = await client.client.get('/account');
  console.log('User address:', response.data.address);
  console.log('User balance:', response.data.balance);
  return response.data;
}
```

## Step 2: Read Tokens & Balances

### 2.1 List All Tokens with Balances

```javascript
async function getTokensWithBalances(userAddress) {
  const response = await client.client.get('/tokens/v2', {
    params: {
      status: 'neq.2', // Exclude deprecated tokens
      'balances.key': `eq.${userAddress}`,
      limit: 50,
      offset: 0
    }
  });

  const tokens = response.data.tokens.map(token => ({
    address: token.address,
    symbol: token._symbol,
    name: token._name,
    decimals: token.customDecimals,
    balance: token.balances[0]?.balance || '0',
    imageUrl: token.images[0]?.value
  }));

  return tokens;
}

// Usage
const tokens = await getTokensWithBalances(account.address);
console.log('User tokens:', tokens);
```

### 2.2 Get Specific Token Balance

```javascript
async function getTokenBalance(tokenAddress, userAddress) {
  const response = await client.client.get(`/tokens/v2/${tokenAddress}`, {
    params: {
      'balances.key': `eq.${userAddress}`
    }
  });

  const balance = response.data.balances[0]?.balance || '0';
  return balance;
}
```

## Step 3: Bridge Assets

### 3.1 Get Bridgeable Tokens

```javascript
async function getBridgeableTokens() {
  const response = await client.client.get('/bridge/supported-tokens');
  return response.data.tokens;
}
```

### 3.2 Initiate Bridge In (Deposit)

```javascript
async function bridgeIn(tokenAddress, amount, sourceChain = 'ethereum') {
  // Step 1: Prepare bridge deposit
  const response = await client.client.post('/bridge/deposit', {
    tokenAddress,
    amount, // in wei
    sourceChain
  });

  const { depositData, signature } = response.data;

  console.log('Sign this transaction on', sourceChain);
  console.log('Contract:', depositData.bridgeContract);
  console.log('Amount:', amount);

  // Step 2: User signs transaction on source chain (e.g., MetaMask)
  // (Implementation depends on wallet integration)

  return { depositData, signature };
}
```

### 3.3 Track Deposit Status

```javascript
async function getDepositHistory() {
  const response = await client.client.get('/bridge/deposits');
  return response.data.deposits;
}

async function waitForDeposit(depositId) {
  while (true) {
    const deposits = await getDepositHistory();
    const deposit = deposits.find(d => d.id === depositId);

    if (deposit.status === 'confirmed') {
      console.log('Deposit confirmed!');
      return deposit;
    }

    if (deposit.status === 'failed') {
      throw new Error('Deposit failed');
    }

    console.log('Deposit status:', deposit.status);
    await sleep(5000); // Poll every 5 seconds
  }
}
```

### 3.4 Bridge Out (Withdraw)

```javascript
async function bridgeOut(tokenAddress, amount, destinationAddress, destinationChain = 'ethereum') {
  const response = await client.client.post('/bridge/withdraw', {
    tokenAddress,
    amount,
    destinationAddress,
    destinationChain
  });

  return response.data; // { txHash, status }
}
```

## Step 4: Swap Assets

### 4.1 Discover Available Pools

```javascript
async function getSwapPools() {
  const response = await client.client.get('/swap-pools');
  return response.data.pools;
}

async function findPoolForPair(tokenA, tokenB) {
  const response = await client.client.get(`/swap-pools/${tokenA}/${tokenB}`);
  return response.data.pool;
}
```

### 4.2 Calculate Swap Output

```javascript
function calculateSwapOutput(amountIn, reserveIn, reserveOut, feeRate = 0.003) {
  // Constant product formula: x * y = k
  // With fee: amountInWithFee = amountIn * (1 - fee)
  const amountInWithFee = amountIn * (1 - feeRate);
  const amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);
  return Math.floor(amountOut);
}

// Usage
const pool = await findPoolForPair(tokenAAddress, tokenBAddress);
const amountIn = 1e18; // 1 token (18 decimals)
const amountOut = calculateSwapOutput(
  amountIn,
  parseFloat(pool.tokenABalance),
  parseFloat(pool.tokenBBalance),
  parseFloat(pool.swapFeeRate)
);

console.log('Expected output:', amountOut);
```

### 4.3 Execute Swap

```javascript
async function executeSwap(poolAddress, fromToken, toToken, amountIn, slippageTolerance = 0.005) {
  // Calculate minimum output with slippage
  const pool = await client.client.get(`/swap-pools/${poolAddress}`).then(r => r.data);
  const expectedOut = calculateSwapOutput(
    amountIn,
    parseFloat(pool.tokenABalance),
    parseFloat(pool.tokenBBalance),
    parseFloat(pool.swapFeeRate)
  );

  const minAmountOut = Math.floor(expectedOut * (1 - slippageTolerance));
  const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes

  // Step 1: Approve token spending
  await approveToken(fromToken, poolAddress, amountIn);

  // Step 2: Execute swap
  const response = await client.client.post(`/swap-pools/${poolAddress}/swap`, {
    fromToken,
    toToken,
    amountIn: amountIn.toString(),
    minAmountOut: minAmountOut.toString(),
    deadline
  });

  console.log('Swap executed:', response.data.txHash);
  console.log('Amount received:', response.data.amountOut);

  return response.data;
}
```

### 4.4 Approve Token Spending

```javascript
async function approveToken(tokenAddress, spenderAddress, amount) {
  const response = await client.client.post(`/tokens/v2/${tokenAddress}/approve`, {
    spender: spenderAddress,
    amount: amount.toString()
  });

  console.log('Approval tx:', response.data.txHash);
  return response.data.txHash;
}
```

## Step 5: Lending Pool Operations

### 5.1 Get Lending Positions

```javascript
async function getLendingPositions() {
  const response = await client.client.get('/lending/positions');

  const { supplied, borrowed, healthFactor } = response.data.positions;

  console.log('Supplied collateral:', supplied);
  console.log('Borrowed USDST:', borrowed);
  console.log('Health factor:', healthFactor);

  return response.data.positions;
}
```

### 5.2 Supply Collateral

```javascript
async function supplyCollateral(tokenAddress, amount) {
  // Step 1: Approve lending pool to spend tokens
  await approveToken(tokenAddress, LENDING_POOL_ADDRESS, amount);

  // Step 2: Supply collateral
  const response = await client.client.post('/lending/supply', {
    tokenAddress,
    amount: amount.toString()
  });

  console.log('Collateral supplied:', response.data.txHash);
  return response.data;
}
```

### 5.3 Borrow USDST

```javascript
async function borrowUSDST(amount, collateralToken) {
  const response = await client.client.post('/lending/borrow', {
    amount: amount.toString(),
    collateralToken // Optional: specify which collateral to use
  });

  console.log('Borrowed USDST:', response.data.txHash);
  console.log('New health factor:', response.data.healthFactor);

  return response.data;
}
```

### 5.4 Repay Debt

```javascript
async function repayDebt(amount) {
  // Step 1: Approve USDST spending
  await approveToken(USDST_ADDRESS, LENDING_POOL_ADDRESS, amount);

  // Step 2: Repay
  const response = await client.client.post('/lending/repay', {
    amount: amount.toString()
  });

  console.log('Debt repaid:', response.data.txHash);
  console.log('Remaining debt:', response.data.remainingDebt);

  return response.data;
}
```

### 5.5 Withdraw Collateral

```javascript
async function withdrawCollateral(tokenAddress, amount) {
  const response = await client.client.post('/lending/withdraw', {
    tokenAddress,
    amount: amount.toString()
  });

  console.log('Collateral withdrawn:', response.data.txHash);
  return response.data;
}
```

## Step 6: CDP (Collateralized Debt Position)

### 6.1 Get CDP Vaults

```javascript
async function getCDPVaults() {
  const response = await client.client.get('/cdp/vaults');

  console.log('CDP vaults:', response.data.vaults);

  return response.data.vaults;
}
```

### 6.2 Get Vault Candidates (for Mint Planning)

```javascript
async function getVaultCandidates() {
  const response = await client.client.get('/cdp/vault-candidates');

  // Returns: available collateral types + user holdings
  console.log('Vault candidates:', response.data.candidates);

  return response.data.candidates;
}
```

### 6.3 Mint USDST

```javascript
async function mintUSDST(collateralToken, collateralAmount, mintAmount) {
  // Step 1: Approve collateral spending
  await approveToken(collateralToken, CDP_CONTRACT_ADDRESS, collateralAmount);

  // Step 2: Mint USDST
  const response = await client.client.post('/cdp/mint', {
    collateralToken,
    collateralAmount: collateralAmount.toString(),
    mintAmount: mintAmount.toString()
  });

  console.log('USDST minted:', response.data.txHash);
  console.log('Vault CR:', response.data.collateralizationRatio);

  return response.data;
}
```

### 6.4 Repay CDP (Burn USDST)

```javascript
async function repayCDP(vaultId, amount) {
  // Step 1: Approve USDST burning
  await approveToken(USDST_ADDRESS, CDP_CONTRACT_ADDRESS, amount);

  // Step 2: Repay (burn)
  const response = await client.client.post('/cdp/repay', {
    vaultId,
    amount: amount.toString()
  });

  console.log('CDP debt repaid:', response.data.txHash);
  return response.data;
}
```

### 6.5 Withdraw Collateral from CDP

```javascript
async function withdrawCDPCollateral(vaultId, amount) {
  const response = await client.client.post('/cdp/withdraw', {
    vaultId,
    amount: amount.toString()
  });

  console.log('CDP collateral withdrawn:', response.data.txHash);
  return response.data;
}
```

## Step 7: Rewards

### 7.1 Get Rewards Balance

```javascript
async function getRewardsBalance() {
  const response = await client.client.get('/rewards');

  const { unclaimed, activities } = response.data;

  console.log('Unclaimed CATA:', unclaimed);
  console.log('Breakdown by activity:', activities);

  return response.data;
}
```

### 7.2 Get Reward Activities & Rates

```javascript
async function getRewardActivities() {
  const response = await client.client.get('/rewards/activities');

  console.log('Current season activities:', response.data.activities);

  return response.data.activities;
}
```

### 7.3 Claim Rewards

```javascript
async function claimRewards() {
  const response = await client.client.post('/rewards/claim');

  console.log('Rewards claimed:', response.data.txHash);
  console.log('Amount:', response.data.amountClaimed);

  return response.data;
}
```

### 7.4 Get Claim History

```javascript
async function getClaimHistory() {
  const response = await client.client.get('/rewards/history');

  console.log('Past claims:', response.data.claims);

  return response.data.claims;
}
```

## Complete Example: Borrow USDST Flow

```javascript
async function completeBorrowFlow() {
  // 1. Authenticate
  const { accessToken } = await login('myuser', 'mypassword');
  const client = new StratoClient(accessToken);

  // 2. Get account
  const account = await getAccount();
  console.log('User address:', account.address);

  // 3. Check current positions
  const positions = await getLendingPositions();
  console.log('Current health factor:', positions.healthFactor);

  // 4. Supply collateral (1 ETHST)
  const ETHST_ADDRESS = '0x93fb7295859b2d70199e0a4883b7c320cf874e6c';
  const collateralAmount = BigInt(1e18); // 1 ETHST

  await supplyCollateral(ETHST_ADDRESS, collateralAmount);
  console.log('Collateral supplied!');

  // 5. Borrow USDST (2000 USDST, assuming ETHST = $3000)
  const borrowAmount = BigInt(2000 * 1e18); // 2000 USDST

  const borrowResult = await borrowUSDST(borrowAmount, ETHST_ADDRESS);
  console.log('Borrowed USDST!');
  console.log('New health factor:', borrowResult.healthFactor);

  // 6. Check rewards accrual
  const rewards = await getRewardsBalance();
  console.log('Rewards earned:', rewards.unclaimed);

  return {
    positions: await getLendingPositions(),
    rewards
  };
}

// Run
completeBorrowFlow()
  .then(result => console.log('Final state:', result))
  .catch(error => console.error('Error:', error));
```

## Error Handling

### Common Errors

```javascript
async function safeApiCall(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error.response) {
      const { status, data } = error.response;

      switch (status) {
        case 400:
          console.error('Validation error:', data.error.message);
          break;
        case 401:
          console.error('Authentication failed - refresh token');
          // Auto-retry with refresh handled by interceptor
          break;
        case 500:
          console.error('Server error:', data.error.message);
          // Retry with exponential backoff
          break;
        default:
          console.error('API error:', data.error);
      }
    } else {
      console.error('Network error:', error.message);
    }

    throw error;
  }
}
```

### Retry Logic

```javascript
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1 || error.response?.status < 500) {
        throw error;
      }

      const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
      console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms`);
      await sleep(delay);
    }
  }
}
```

## Testing

### Unit Tests

```javascript
const { expect } = require('chai');

describe('STRATO Integration', () => {
  let client;

  before(async () => {
    const { accessToken } = await login('testuser', 'testpass');
    client = new StratoClient(accessToken);
  });

  it('should fetch tokens', async () => {
    const tokens = await getTokensWithBalances(testAddress);
    expect(tokens).to.be.an('array');
    expect(tokens.length).to.be.greaterThan(0);
  });

  it('should execute swap', async () => {
    const result = await executeSwap(poolAddress, tokenA, tokenB, amount);
    expect(result.txHash).to.match(/^0x[a-fA-F0-9]{64}$/);
    expect(result.amountOut).to.be.greaterThan(0);
  });
});
```

### Integration Tests

```javascript
describe('End-to-End Borrow Flow', () => {
  it('should complete full borrow cycle', async () => {
    // Supply → Borrow → Repay → Withdraw
    await supplyCollateral(ETHST, amount);
    await borrowUSDST(borrowAmount, ETHST);

    const positions = await getLendingPositions();
    expect(positions.borrowed).to.be.greaterThan(0);

    await repayDebt(borrowAmount);
    await withdrawCollateral(ETHST, amount);

    const finalPositions = await getLendingPositions();
    expect(finalPositions.borrowed).to.equal(0);
  });
});
```

## Best Practices

### 1. Transaction Confirmation

Always wait for transaction confirmation before proceeding:

```javascript
async function waitForTx(txHash) {
  while (true) {
    const tx = await client.client.get(`/transactions/${txHash}`);
    if (tx.data.status === 'confirmed') return tx.data;
    if (tx.data.status === 'failed') throw new Error('Transaction failed');
    await sleep(2000);
  }
}
```

### 2. Balance Checks

Verify sufficient balance before operations:

```javascript
async function ensureSufficientBalance(tokenAddress, requiredAmount) {
  const balance = await getTokenBalance(tokenAddress, account.address);
  if (BigInt(balance) < BigInt(requiredAmount)) {
    throw new Error(`Insufficient balance: have ${balance}, need ${requiredAmount}`);
  }
}
```

### 3. Health Factor Monitoring

For lending/CDP, always check health factor after operations:

```javascript
async function ensureSafeHealthFactor(minHealthFactor = 1.5) {
  const positions = await getLendingPositions();
  if (parseFloat(positions.healthFactor) < minHealthFactor) {
    console.warn('Health factor below safe threshold!');
    // Take corrective action (repay or add collateral)
  }
}
```

## References

- [API Overview](../reference/api.md) - Complete API documentation
- [Available Tokens](../concepts.md#available-tokens) - Token details and standards
- [Bridge Guide](../guides/bridge.md) - Cross-chain bridging
- [Swap](../guides/swap.md) & [Liquidity](../guides/liquidity.md) - AMM swaps and liquidity
- [Borrow Guide](../guides/borrow.md) - Lending pool operations
- [CDP Guide](../guides/mint-cdp.md) - CDP vault management
- [Rewards Guide](../guides/rewards.md) - Rewards system
- [Core Platform API](../reference/strato-node-api.md) - Low-level blockchain API
- [Architecture](../reference/architecture.md) - System architecture


