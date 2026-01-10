# End-to-End Integration Examples

Complete workflow examples for building on STRATO using REST APIs.

!!! danger "Important: ethers.js Does NOT Work"
    **You CANNOT use ethers.js or web3.js with STRATO.**
    
    Use STRATO REST APIs: `/strato/v2.3`, `/cirrus/search`, `/bloc/v2.2`

!!! note "About STRATO Endpoints"
    **All examples use `localhost` for local development.**
    
    For production, use public endpoints:
    
    - **Mainnet:** `https://app.strato.nexus`
    - **Testnet:** `https://buildtest.mercata-testnet.blockapps.net`
    
    **In your code:**
    
    ```typescript
    // For local dev:
    const NODE_URL = 'http://localhost:8080';
    
    // For production (replace localhost with):
    // const NODE_URL = 'https://app.strato.nexus';  // mainnet
    // const NODE_URL = 'https://buildtest.mercata-testnet.blockapps.net';  // testnet
    
    const strato = createApiClient(`${NODE_URL}/strato/v2.3`);
    const cirrus = createApiClient(`${NODE_URL}/cirrus/search`);
    ```

---

## Example 1: Yield Farming App

Build an app that helps users earn yield through lending and liquidity provision.

### User Flow

1. Supply ETHST as collateral to Lending Pool
2. Borrow USDST against collateral
3. Swap USDST → sUSDSST
4. Provide sUSDSST-USDST liquidity
5. Earn trading fees + Reward Points

### Implementation

```typescript
import { strato, cirrus, bloc } from './config';
import { getAccessToken } from './auth';

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

class YieldFarmingApp {
  private accessToken: string;
  private userAddress: string;
  
  constructor(accessToken: string, userAddress: string) {
    this.accessToken = accessToken;
    this.userAddress = userAddress;
  }
  
  async executeStrategy(ethstAmount: string) {
    console.log('Starting yield farming strategy...');
    
    // 1. Supply ETHST collateral
    await this.supplyCollateral(ethstAmount);
    
    // 2. Borrow USDST (50% of collateral value)
    const ethPrice = await this.getETHPrice();
    const borrowAmount = (BigInt(ethstAmount) * BigInt(ethPrice) * 50n / 100n).toString();
    await this.borrowUSDST(borrowAmount);
    
    // 3. Swap USDST → sUSDSST
    await this.swapToSUSDSST(borrowAmount);
    
    // 4. Provide liquidity
    const halfAmount = (BigInt(borrowAmount) / 2n).toString();
    await this.provideLiquidity(halfAmount, halfAmount);
    
    // 5. Get position summary
    return await this.getPositionSummary();
  }
  
  async supplyCollateral(amount: string) {
    const LENDING_POOL = await this.getLendingPoolAddress();
    const ETHST_TOKEN = await this.getTokenAddress('ETHST');
    
    const tx = buildFunctionTx([
      {
        contractName: 'Token',
        contractAddress: ETHST_TOKEN,
        method: 'approve',
        args: { spender: LENDING_POOL, value: amount }
      },
      {
        contractName: 'LendingPool',
        contractAddress: LENDING_POOL,
        method: 'supplyCollateral',
        args: { asset: ETHST_TOKEN, amount }
      }
    ]);
    
    await submitTransaction(this.accessToken, tx);
    console.log('✅ Supplied collateral');
  }
  
  async borrowUSDST(amount: string) {
    const LENDING_POOL = await this.getLendingPoolAddress();
    const USDST_TOKEN = await this.getTokenAddress('USDST');
    
    const tx = buildFunctionTx({
      contractName: 'LendingPool',
      contractAddress: LENDING_POOL,
      method: 'borrow',
      args: { asset: USDST_TOKEN, amount }
    });
    
    await submitTransaction(this.accessToken, tx);
    console.log('✅ Borrowed USDST');
  }
  
  async swapToSUSDSST(amount: string) {
    const ROUTER = await this.getRouterAddress();
    const USDST_TOKEN = await this.getTokenAddress('USDST');
    const SUSDST_TOKEN = await this.getTokenAddress('sUSDSST');
    
    const tx = buildFunctionTx([
      {
        contractName: 'Token',
        contractAddress: USDST_TOKEN,
        method: 'approve',
        args: { spender: ROUTER, value: amount }
      },
      {
        contractName: 'Router',
        contractAddress: ROUTER,
        method: 'swapExactTokensForTokens',
        args: {
          amountIn: amount,
          amountOutMin: (BigInt(amount) * 995n / 1000n).toString(), // 0.5% slippage
          path: [USDST_TOKEN, SUSDST_TOKEN],
          to: this.userAddress,
          deadline: Math.floor(Date.now() / 1000) + 1200
        }
      }
    ]);
    
    await submitTransaction(this.accessToken, tx);
    console.log('✅ Swapped to sUSDSST');
  }
  
  async provideLiquidity(amountA: string, amountB: string) {
    const ROUTER = await this.getRouterAddress();
    const USDST_TOKEN = await this.getTokenAddress('USDST');
    const SUSDST_TOKEN = await this.getTokenAddress('sUSDSST');
    
    const tx = buildFunctionTx([
      {
        contractName: 'Token',
        contractAddress: USDST_TOKEN,
        method: 'approve',
        args: { spender: ROUTER, value: amountA }
      },
      {
        contractName: 'Token',
        contractAddress: SUSDST_TOKEN,
        method: 'approve',
        args: { spender: ROUTER, value: amountB }
      },
      {
        contractName: 'Router',
        contractAddress: ROUTER,
        method: 'addLiquidity',
        args: {
          tokenA: USDST_TOKEN,
          tokenB: SUSDST_TOKEN,
          amountADesired: amountA,
          amountBDesired: amountB,
          amountAMin: (BigInt(amountA) * 95n / 100n).toString(),
          amountBMin: (BigInt(amountB) * 95n / 100n).toString(),
          to: this.userAddress,
          deadline: Math.floor(Date.now() / 1000) + 1200
        }
      }
    ]);
    
    await submitTransaction(this.accessToken, tx);
    console.log('✅ Provided liquidity');
  }
  
  async getPositionSummary() {
    // Query user's positions from Cirrus
    const collateral = await this.getUserCollateral();
    const debt = await this.getUserDebt();
    const lpTokens = await this.getUserLPTokens();
    
    return {
      collateral,
      debt,
      lpTokens,
      healthFactor: await this.calculateHealthFactor()
    };
  }
  
  // Helper methods
  async getLendingPoolAddress(): Promise<string> {
    const response = await cirrus.get('/LendingRegistry', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        address: 'eq.0000000000000000000000000000000000001007',
        select: 'lendingPool'
      }
    });
    return response.data[0].lendingPool;
  }
  
  async getTokenAddress(symbol: string): Promise<string> {
    const response = await cirrus.get('/Token', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        _symbol: `eq.${symbol}`,
        select: 'address'
      }
    });
    return response.data[0].address;
  }
  
  async getRouterAddress(): Promise<string> {
    // Router address from pool factory
    return '0x...'; // Get from your deployment
  }
  
  async getETHPrice(): Promise<number> {
    // Get from price oracle
    return 3000; // $3000 per ETHST
  }
  
  async getUserCollateral() {
    // Query from Cirrus
    return {};
  }
  
  async getUserDebt() {
    // Query from Cirrus
    return {};
  }
  
  async getUserLPTokens() {
    // Query from Cirrus
    return {};
  }
  
  async calculateHealthFactor() {
    // Calculate from collateral and debt
    return 2.5;
  }
}

// Usage
async function main() {
  const accessToken = await getAccessToken();
  const userAddress = '0x...'; // Your address
  
  const app = new YieldFarmingApp(accessToken, userAddress);
  const result = await app.executeStrategy('1000000000000000000'); // 1 ETHST
  
  console.log('Position summary:', result);
}

main().catch(console.error);
```

---

## Example 2: Portfolio Dashboard

Build a dashboard showing user's complete DeFi position.

### Implementation

```typescript
class PortfolioDashboard {
  private accessToken: string;
  private userAddress: string;
  
  constructor(accessToken: string, userAddress: string) {
    this.accessToken = accessToken;
    this.userAddress = userAddress;
  }
  
  async getCompletePortfolio() {
    const [tokens, lending, cdp, liquidity, rewards] = await Promise.all([
      this.getTokenBalances(),
      this.getLendingPosition(),
      this.getCDPPosition(),
      this.getLiquidityPositions(),
      this.getRewards()
    ]);
    
    return {
      tokens,
      lending,
      cdp,
      liquidity,
      rewards,
      totalValue: await this.calculateTotalValue()
    };
  }
  
  async getTokenBalances() {
    const response = await cirrus.get('/Token-_balances', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        key: `eq.${this.userAddress}`,
        select: 'address,value::text'
      }
    });
    
    // Enrich with token metadata
    const balances = response.data;
    const enriched = await Promise.all(
      balances.map(async (b: any) => {
        const token = await this.getTokenMetadata(b.address);
        return {
          ...token,
          balance: b.value
        };
      })
    );
    
    return enriched;
  }
  
  async getLendingPosition() {
    const COLLATERAL_VAULT = await this.getCollateralVaultAddress();
    
    const collateral = await cirrus.get('/CollateralVault-userCollaterals', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        address: `eq.${COLLATERAL_VAULT}`,
        key: `eq.${this.userAddress}`,
        select: 'key2,value::text'
      }
    });
    
    const debt = await cirrus.get('/LendingPool-userDebts', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        key: `eq.${this.userAddress}`,
        select: 'key2,value::text'
      }
    });
    
    return {
      collateral: collateral.data,
      debt: debt.data
    };
  }
  
  async getCDPPosition() {
    const CDP_VAULT = await this.getCDPVaultAddress();
    
    const collateral = await cirrus.get('/CDPVault-userCollaterals', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        address: `eq.${CDP_VAULT}`,
        key: `eq.${this.userAddress}`,
        select: 'key2,value::text'
      }
    });
    
    const debt = await cirrus.get('/CDPEngine-userDebts', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        key: `eq.${this.userAddress}`,
        select: 'key2,value::text'
      }
    });
    
    return {
      collateral: collateral.data,
      debt: debt.data
    };
  }
  
  async getLiquidityPositions() {
    // Get all pools
    const pools = await cirrus.get('/Pool', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        select: 'address,_token0,_token1'
      }
    });
    
    // Get user's LP token balances
    const lpBalances = await Promise.all(
      pools.data.map(async (pool: any) => {
        const balance = await cirrus.get('/Pool-_balances', {
          headers: { Authorization: `Bearer ${this.accessToken}` },
          params: {
            address: `eq.${pool.address}`,
            key: `eq.${this.userAddress}`,
            select: 'value::text'
          }
        });
        
        return {
          pool: pool.address,
          token0: pool._token0,
          token1: pool._token1,
          lpBalance: balance.data[0]?.value || '0'
        };
      })
    );
    
    return lpBalances.filter(b => BigInt(b.lpBalance) > 0n);
  }
  
  async getRewards() {
    const REWARDS_ADDRESS = await this.getRewardsAddress();
    
    const response = await cirrus.get('/Rewards-userInfo', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        address: `eq.${REWARDS_ADDRESS}`,
        key: `eq.${this.userAddress}`,
        select: '*'
      }
    });
    
    return response.data;
  }
  
  async calculateTotalValue() {
    // Calculate total portfolio value in USD
    return 0;
  }
  
  // Helper methods
  async getTokenMetadata(address: string) {
    const response = await cirrus.get('/Token', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        address: `eq.${address}`,
        select: '_name,_symbol,_decimals'
      }
    });
    return response.data[0];
  }
  
  async getCollateralVaultAddress(): Promise<string> {
    const response = await cirrus.get('/LendingRegistry', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        address: 'eq.0000000000000000000000000000000000001007',
        select: 'collateralVault'
      }
    });
    return response.data[0].collateralVault;
  }
  
  async getCDPVaultAddress(): Promise<string> {
    const response = await cirrus.get('/CDPRegistry', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        address: 'eq.0000000000000000000000000000000000001012',
        select: 'cdpVault'
      }
    });
    return response.data[0].cdpVault;
  }
  
  async getRewardsAddress(): Promise<string> {
    return '0x...'; // Get from your deployment
  }
}

// Usage
async function main() {
  const accessToken = await getAccessToken();
  const userAddress = '0x...';
  
  const dashboard = new PortfolioDashboard(accessToken, userAddress);
const portfolio = await dashboard.getCompletePortfolio();
  
  console.log('Complete portfolio:', JSON.stringify(portfolio, null, 2));
}

main().catch(console.error);
```

---

## Example 3: Liquidation Bot

Monitor positions and execute liquidations when profitable.

### Implementation

```typescript
class LiquidationBot {
  private accessToken: string;
  private botAddress: string;
  
  constructor(accessToken: string, botAddress: string) {
    this.accessToken = accessToken;
    this.botAddress = botAddress;
  }
  
  async start() {
    console.log('Starting liquidation bot...');
    
    while (true) {
      try {
        // 1. Find unhealthy positions
        const targets = await this.findLiquidationTargets();
        
        // 2. Execute liquidations
        for (const target of targets) {
          await this.liquidate(target);
        }
        
        // Wait 10 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 10000));
        
      } catch (error) {
        console.error('Bot error:', error);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }
  }
  
  async findLiquidationTargets() {
    // Query all users with debt
    const users = await cirrus.get('/LendingPool-userDebts', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        select: 'key,key2,value::text',
        value: 'gt.0'
      }
    });
    
    // Check health factor for each
    const targets = [];
    for (const user of users.data) {
      const healthFactor = await this.calculateHealthFactor(user.key);
      if (healthFactor < 1.0) {
        targets.push({
          user: user.key,
          asset: user.key2,
          debt: user.value,
          healthFactor
        });
      }
    }
    
    return targets;
  }
  
  async liquidate(target: any) {
    console.log(`Liquidating ${target.user}...`);
    
    const LENDING_POOL = await this.getLendingPoolAddress();
    
    const tx = buildFunctionTx({
      contractName: 'LendingPool',
      contractAddress: LENDING_POOL,
      method: 'liquidationCall',
      args: {
        collateralAsset: target.asset,
        debtAsset: target.asset,
        user: target.user,
        debtToCover: target.debt,
        receiveAToken: false
      }
    });
    
    await submitTransaction(this.accessToken, tx);
    console.log('✅ Liquidation successful');
  }
  
  async calculateHealthFactor(userAddress: string): Promise<number> {
    // Get collateral and debt
    // Calculate health factor
    return 1.5;
  }
  
  async getLendingPoolAddress(): Promise<string> {
    const response = await cirrus.get('/LendingRegistry', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        address: 'eq.0000000000000000000000000000000000001007',
        select: 'lendingPool'
      }
    });
    return response.data[0].lendingPool;
  }
}

// Usage
async function main() {
  const accessToken = await getAccessToken();
  const botAddress = '0x...';
  
  const bot = new LiquidationBot(accessToken, botAddress);
  await bot.start();
}

main().catch(console.error);
```

---

## Best Practices

### 1. Error Handling

```typescript
try {
  const result = await submitTransaction(accessToken, tx);
} catch (error: any) {
  if (error.response?.status === 400) {
    // Transaction failed - parse error message
    console.error('Transaction failed:', error.response.data);
  } else if (error.response?.status === 401) {
    // Token expired - refresh
    accessToken = await getAccessToken();
  }
}
```

### 2. Rate Limiting

```typescript
class RateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  
  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.process();
    });
  }
  
  private async process() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    const fn = this.queue.shift()!;
    
    await fn();
    await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
    
    this.processing = false;
    this.process();
  }
}
```

### 3. Batch Operations

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
  
  return await Promise.all(promises);
}
```

---

## Next Steps

- **[Quick Start](quickstart.md)** - Build your first app
- **[API Integration](integration.md)** - Complete integration guide
- **[Quick Reference](quick-reference.md)** - Code snippets

### Study the Reference Implementation

The **mercata app** (`strato-platform/mercata/`) is the complete reference:

- **Backend** - `mercata/backend/src/`
- **Services** - `mercata/backend/src/api/services/`
- **Helpers** - `mercata/backend/src/api/helpers/`
