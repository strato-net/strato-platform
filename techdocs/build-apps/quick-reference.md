# Developer Quick Reference

Fast reference for common STRATO operations.

---

## Contract Addresses

### Mainnet

```javascript
const CONTRACTS = {
  // Core
  LENDING_POOL: '0x...',
  COLLATERAL_VAULT: '0x...',
  CDP_ENGINE: '0x...',
  
  // Tokens
  USDST: '0x...',
  ETH: '0x...',
  BTC: '0x...',
  USDC: '0x...',
  
  // DEX
  ROUTER: '0x...',
  FACTORY: '0x...',
  
  // Bridge
  BRIDGE: '0x...',
  
  // Rewards
  REWARDS_DISTRIBUTOR: '0x...',
  CATA_TOKEN: '0x...'
};
```

> **Note:** Get latest addresses from [Contract Addresses](contract-addresses.md)

---

## Common ABIs

###  ERC20 Token

```javascript
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
];
```

### Lending Pool

```javascript
const LENDING_POOL_ABI = [
  'function supplyCollateral(address asset, uint256 amount)',
  'function withdrawCollateral(address asset, uint256 amount)',
  'function borrow(address asset, uint256 amount)',
  'function repay(address asset, uint256 amount)',
  'function getHealthFactor(address user) view returns (uint256)',
  'function getUserAccountData(address user) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'
];
```

### CDP Engine

```javascript
const CDP_ENGINE_ABI = [
  'function deposit(address asset, uint256 amount)',
  'function withdraw(address asset, uint256 amount)',
  'function mint(uint256 amount)',
  'function burn(uint256 amount)',
  'function getVault(address user) view returns (uint256,uint256,uint256)'
];
```

### DEX Router

```javascript
const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])',
  'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256,uint256,uint256)',
  'function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256,uint256)',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])'
];
```

---

## Lending Operations

### Supply Collateral

```javascript
async function supplyCollateral(asset, amount) {
  const ethToken = new ethers.Contract(asset, ERC20_ABI, wallet);
  const pool = new ethers.Contract(LENDING_POOL, LENDING_POOL_ABI, wallet);
  
  // 1. Approve
  const tx1 = await ethToken.approve(LENDING_POOL, amount);
  await tx1.wait();
  
  // 2. Supply
  const tx2 = await pool.supplyCollateral(asset, amount);
  await tx2.wait();
  
  return tx2.hash;
}

// Usage
await supplyCollateral(ETH_TOKEN, ethers.parseEther('1.0'));
```

### Borrow

```javascript
async function borrow(asset, amount) {
  const pool = new ethers.Contract(LENDING_POOL, LENDING_POOL_ABI, wallet);
  
  const tx = await pool.borrow(asset, amount);
  await tx.wait();
  
  return tx.hash;
}

// Usage
await borrow(USDST_TOKEN, ethers.parseEther('500'));
```

### Repay Debt

```javascript
async function repay(asset, amount) {
  const token = new ethers.Contract(asset, ERC20_ABI, wallet);
  const pool = new ethers.Contract(LENDING_POOL, LENDING_POOL_ABI, wallet);
  
  // 1. Approve
  const tx1 = await token.approve(LENDING_POOL, amount);
  await tx1.wait();
  
  // 2. Repay
  const tx2 = await pool.repay(asset, amount);
  await tx2.wait();
  
  return tx2.hash;
}

// Usage
await repay(USDST_TOKEN, ethers.parseEther('500'));
```

### Check Health Factor

```javascript
async function getHealthFactor(userAddress) {
  const pool = new ethers.Contract(LENDING_POOL, LENDING_POOL_ABI, provider);
  
  const hf = await pool.getHealthFactor(userAddress);
  return ethers.formatEther(hf); // Returns as string (e.g., "1.5")
}

// Usage
const hf = await getHealthFactor(wallet.address);
console.log('Health Factor:', hf);
```

### Get User Data

```javascript
async function getUserData(userAddress) {
  const pool = new ethers.Contract(LENDING_POOL, LENDING_POOL_ABI, provider);
  
  const [
    totalCollateralETH,
    totalDebtETH,
    availableBorrowsETH,
    currentLiquidationThreshold,
    ltv,
    healthFactor
  ] = await pool.getUserAccountData(userAddress);
  
  return {
    collateral: ethers.formatEther(totalCollateralETH),
    debt: ethers.formatEther(totalDebtETH),
    availableBorrows: ethers.formatEther(availableBorrowsETH),
    healthFactor: ethers.formatEther(healthFactor)
  };
}

// Usage
const data = await getUserData(wallet.address);
console.log(data);
```

---

## CDP Operations

### Deposit Collateral to CDP

```javascript
async function depositCDP(asset, amount) {
  const token = new ethers.Contract(asset, ERC20_ABI, wallet);
  const cdp = new ethers.Contract(CDP_ENGINE, CDP_ENGINE_ABI, wallet);
  
  // 1. Approve
  const tx1 = await token.approve(CDP_ENGINE, amount);
  await tx1.wait();
  
  // 2. Deposit
  const tx2 = await cdp.deposit(asset, amount);
  await tx2.wait();
  
  return tx2.hash;
}

// Usage
await depositCDP(ETH_TOKEN, ethers.parseEther('5.0'));
```

### Mint USDST

```javascript
async function mintUSDST(amount) {
  const cdp = new ethers.Contract(CDP_ENGINE, CDP_ENGINE_ABI, wallet);
  
  const tx = await cdp.mint(amount);
  await tx.wait();
  
  return tx.hash;
}

// Usage
await mintUSDST(ethers.parseEther('1000'));
```

### Burn USDST (Repay CDP)

```javascript
async function burnUSDST(amount) {
  const usdst = new ethers.Contract(USDST_TOKEN, ERC20_ABI, wallet);
  const cdp = new ethers.Contract(CDP_ENGINE, CDP_ENGINE_ABI, wallet);
  
  // 1. Approve
  const tx1 = await usdst.approve(CDP_ENGINE, amount);
  await tx1.wait();
  
  // 2. Burn
  const tx2 = await cdp.burn(amount);
  await tx2.wait();
  
  return tx2.hash;
}

// Usage
await burnUSDST(ethers.parseEther('1000'));
```

### Get CDP Vault Info

```javascript
async function getVaultInfo(userAddress) {
  const cdp = new ethers.Contract(CDP_ENGINE, CDP_ENGINE_ABI, provider);
  
  const [collateral, debt, collateralizationRatio] = await cdp.getVault(userAddress);
  
  return {
    collateral: ethers.formatEther(collateral),
    debt: ethers.formatEther(debt),
    ratio: ethers.formatUnits(collateralizationRatio, 2) // Percentage
  };
}

// Usage
const vault = await getVaultInfo(wallet.address);
console.log('CR:', vault.ratio + '%');
```

---

## Swap Operations

### Swap Tokens

```javascript
async function swap(tokenIn, tokenOut, amountIn, minAmountOut) {
  const tokenInContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
  
  // 1. Approve
  const tx1 = await tokenInContract.approve(ROUTER, amountIn);
  await tx1.wait();
  
  // 2. Swap
  const path = [tokenIn, tokenOut];
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
  
  const tx2 = await router.swapExactTokensForTokens(
    amountIn,
    minAmountOut,
    path,
    wallet.address,
    deadline
  );
  await tx2.wait();
  
  return tx2.hash;
}

// Usage
await swap(
  USDC_TOKEN,
  ETH_TOKEN,
  ethers.parseUnits('1000', 6), // 1000 USDC
  ethers.parseEther('0.33')     // Min 0.33 ETH
);
```

### Get Swap Quote

```javascript
async function getQuote(tokenIn, tokenOut, amountIn) {
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider);
  
  const path = [tokenIn, tokenOut];
  const amounts = await router.getAmountsOut(amountIn, path);
  
  return amounts[amounts.length - 1]; // Return output amount
}

// Usage
const quote = await getQuote(
  USDC_TOKEN,
  ETH_TOKEN,
  ethers.parseUnits('1000', 6)
);
console.log('You will receive:', ethers.formatEther(quote), 'ETH');
```

---

## Liquidity Operations

### Add Liquidity

```javascript
async function addLiquidity(tokenA, tokenB, amountA, amountB) {
  const tokenAContract = new ethers.Contract(tokenA, ERC20_ABI, wallet);
  const tokenBContract = new ethers.Contract(tokenB, ERC20_ABI, wallet);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
  
  // 1. Approve both tokens
  await (await tokenAContract.approve(ROUTER, amountA)).wait();
  await (await tokenBContract.approve(ROUTER, amountB)).wait();
  
  // 2. Add liquidity
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const slippage = 50n; // 0.5%
  const minA = amountA * (10000n - slippage) / 10000n;
  const minB = amountB * (10000n - slippage) / 10000n;
  
  const tx = await router.addLiquidity(
    tokenA,
    tokenB,
    amountA,
    amountB,
    minA,
    minB,
    wallet.address,
    deadline
  );
  await tx.wait();
  
  return tx.hash;
}

// Usage
await addLiquidity(
  USDST_TOKEN,
  USDC_TOKEN,
  ethers.parseEther('1000'),   // 1000 USDST
  ethers.parseUnits('1000', 6) // 1000 USDC
);
```

### Remove Liquidity

```javascript
async function removeLiquidity(tokenA, tokenB, lpTokenAmount) {
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
  const pairAddress = await factory.getPair(tokenA, tokenB);
  const lpToken = new ethers.Contract(pairAddress, ERC20_ABI, wallet);
  
  // 1. Approve LP tokens
  const tx1 = await lpToken.approve(ROUTER, lpTokenAmount);
  await tx1.wait();
  
  // 2. Remove liquidity
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  
  const tx2 = await router.removeLiquidity(
    tokenA,
    tokenB,
    lpTokenAmount,
    0, // Min amount A (0 for simplicity, set slippage in prod)
    0, // Min amount B
    wallet.address,
    deadline
  );
  await tx2.wait();
  
  return tx2.hash;
}

// Usage
await removeLiquidity(
  USDST_TOKEN,
  USDC_TOKEN,
  ethers.parseEther('100') // 100 LP tokens
);
```

---

## Rewards Operations

### Claim Rewards

```javascript
async function claimRewards() {
  const rewards = new ethers.Contract(
    REWARDS_DISTRIBUTOR,
    ['function claimRewards() returns (uint256)'],
    wallet
  );
  
  const tx = await rewards.claimRewards();
  const receipt = await tx.wait();
  
  // Parse event to get claimed amount
  const claimedEvent = receipt.logs.find(log => 
    log.topics[0] === ethers.id('RewardsClaimed(address,uint256)')
  );
  
  return tx.hash;
}

// Usage
await claimRewards();
```

### Check Pending Rewards

```javascript
async function getPendingRewards(userAddress) {
  const rewards = new ethers.Contract(
    REWARDS_DISTRIBUTOR,
    ['function pendingRewards(address) view returns (uint256)'],
    provider
  );
  
  const pending = await rewards.pendingRewards(userAddress);
  return ethers.formatEther(pending);
}

// Usage
const pending = await getPendingRewards(wallet.address);
console.log('Pending CATA:', pending);
```

---

## Bridge Operations

### Bridge Assets to STRATO

```javascript
async function bridgeToStrato(asset, amount) {
  // On Ethereum mainnet
  const token = new ethers.Contract(asset, ERC20_ABI, ethereumWallet);
  const bridge = new ethers.Contract(
    BRIDGE_ETHEREUM,
    ['function deposit(address token, uint256 amount)'],
    ethereumWallet
  );
  
  // 1. Approve
  const tx1 = await token.approve(BRIDGE_ETHEREUM, amount);
  await tx1.wait();
  
  // 2. Bridge
  const tx2 = await bridge.deposit(asset, amount);
  await tx2.wait();
  
  console.log('Bridging... wait 10-15 minutes');
  console.log('Ethereum TX:', tx2.hash);
  
  return tx2.hash;
}
```

### Bridge Assets from STRATO

```javascript
async function bridgeFromStrato(asset, amount) {
  // On STRATO
  const token = new ethers.Contract(asset, ERC20_ABI, stratoWallet);
  const bridge = new ethers.Contract(
    BRIDGE_STRATO,
    ['function withdraw(address token, uint256 amount)'],
    stratoWallet
  );
  
  // 1. Approve
  const tx1 = await token.approve(BRIDGE_STRATO, amount);
  await tx1.wait();
  
  // 2. Bridge
  const tx2 = await bridge.withdraw(asset, amount);
  await tx2.wait();
  
  console.log('Withdrawing... wait 10-15 minutes');
  console.log('STRATO TX:', tx2.hash);
  
  return tx2.hash;
}
```

---

## Utility Functions

### Check Token Balance

```javascript
async function getBalance(tokenAddress, userAddress) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const balance = await token.balanceOf(userAddress);
  return ethers.formatEther(balance);
}

// Usage
const balance = await getBalance(USDST_TOKEN, wallet.address);
console.log('USDST Balance:', balance);
```

### Check Token Allowance

```javascript
async function getAllowance(tokenAddress, owner, spender) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const allowance = await token.allowance(owner, spender);
  return ethers.formatEther(allowance);
}

// Usage
const allowance = await getAllowance(ETH_TOKEN, wallet.address, LENDING_POOL);
console.log('Allowance:', allowance);
```

### Wait for Transaction with Retry

```javascript
async function waitForTx(txHash, maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        return receipt;
      }
    } catch (error) {
      console.log(`Retry ${i + 1}/${maxRetries}...`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Transaction not found');
}
```

### Batch Multiple Operations

```javascript
async function batchOperations(operations) {
  const results = [];
  
  for (const op of operations) {
    try {
      const result = await op();
      results.push({ success: true, result });
    } catch (error) {
      results.push({ success: false, error: error.message });
    }
  }
  
  return results;
}

// Usage
const results = await batchOperations([
  () => supplyCollateral(ETH_TOKEN, ethers.parseEther('1')),
  () => borrow(USDST_TOKEN, ethers.parseEther('500')),
  () => swap(USDST_TOKEN, USDC_TOKEN, ethers.parseEther('100'), 0)
]);
```

---

## Error Handling

### Common Errors

```javascript
try {
  await someOperation();
} catch (error) {
  // Insufficient funds
  if (error.code === 'INSUFFICIENT_FUNDS') {
    console.error('Not enough balance for gas');
  }
  
  // Transaction reverted
  else if (error.code === 'CALL_EXCEPTION') {
    console.error('Transaction would revert:', error.reason);
  }
  
  // Insufficient allowance
  else if (error.message.includes('insufficient allowance')) {
    console.error('Need to approve tokens first');
  }
  
  // Health factor too low
  else if (error.message.includes('health factor')) {
    console.error('Cannot borrow: health factor too low');
  }
  
  // Network error
  else if (error.code === 'NETWORK_ERROR') {
    console.error('Network issue, retry');
  }
  
  else {
    console.error('Unknown error:', error.message);
  }
}
```

---

## Best Practices

### 1. Always Estimate Gas First

```javascript
const gasEstimate = await contract.method.estimateGas(...args);
const tx = await contract.method(...args, {
  gasLimit: gasEstimate * 120n / 100n // 20% buffer
});
```

### 2. Use Deadlines for DEX Operations

```javascript
const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
```

### 3. Implement Slippage Protection

```javascript
const minOut = expectedOut * 995n / 1000n; // 0.5% slippage
```

### 4. Batch Read Operations

```javascript
const [balance, allowance, healthFactor] = await Promise.all([
  getBalance(token, user),
  getAllowance(token, user, spender),
  getHealthFactor(user)
]);
```

### 5. Log All Transactions

```javascript
console.log('TX hash:', tx.hash);
console.log('Block:', receipt.blockNumber);
console.log('Gas used:', receipt.gasUsed.toString());
```

---

## Complete Example: Full Borrowing Flow

```javascript
const { ethers } = require('ethers');
require('dotenv').config();

async function completeBorrowFlow() {
  // Setup
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log('Address:', wallet.address);
  
  // Contracts
  const ethToken = new ethers.Contract(ETH_TOKEN, ERC20_ABI, wallet);
  const pool = new ethers.Contract(LENDING_POOL, LENDING_POOL_ABI, wallet);
  
  // Amounts
  const collateral = ethers.parseEther('2.0');  // 2 ETH
  const borrowAmount = ethers.parseEther('1000'); // 1000 USDST
  
  try {
    // Step 1: Check initial balance
    const initialETH = await ethToken.balanceOf(wallet.address);
    console.log('1. Initial ETH:', ethers.formatEther(initialETH));
    
    // Step 2: Approve collateral
    console.log('2. Approving ETH...');
    let tx = await ethToken.approve(LENDING_POOL, collateral);
    await tx.wait();
    console.log('   ✅ Approved');
    
    // Step 3: Supply collateral
    console.log('3. Supplying collateral...');
    tx = await pool.supplyCollateral(ETH_TOKEN, collateral);
    await tx.wait();
    console.log('   ✅ Supplied 2 ETH');
    
    // Step 4: Check health factor
    const hf = await pool.getHealthFactor(wallet.address);
    console.log('4. Health Factor:', ethers.formatEther(hf));
    
    // Step 5: Borrow
    console.log('5. Borrowing USDST...');
    tx = await pool.borrow(USDST_TOKEN, borrowAmount);
    await tx.wait();
    console.log('   ✅ Borrowed 1000 USDST');
    
    // Step 6: Check final health factor
    const finalHF = await pool.getHealthFactor(wallet.address);
    console.log('6. Final Health Factor:', ethers.formatEther(finalHF));
    
    // Step 7: Check USDST balance
    const usdst = new ethers.Contract(USDST_TOKEN, ERC20_ABI, wallet);
    const usdstBalance = await usdst.balanceOf(wallet.address);
    console.log('7. USDST Balance:', ethers.formatEther(usdstBalance));
    
    console.log('\n✅ Complete! You now have borrowed USDST.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

completeBorrowFlow();
```

---

## Performance Tips

### Use Multicall for Batch Reads

```javascript
// Instead of multiple calls:
const balance1 = await token1.balanceOf(user);
const balance2 = await token2.balanceOf(user);
const balance3 = await token3.balanceOf(user);

// Use Promise.all:
const [balance1, balance2, balance3] = await Promise.all([
  token1.balanceOf(user),
  token2.balanceOf(user),
  token3.balanceOf(user)
]);
```

### Cache Provider Calls

```javascript
const balanceCache = new Map();

async function getCachedBalance(token, user) {
  const key = `${token}-${user}`;
  if (balanceCache.has(key)) {
    return balanceCache.get(key);
  }
  const balance = await getBalance(token, user);
  balanceCache.set(key, balance);
  return balance;
}
```

---

## Next Steps

- **[API Integration Guide](integration.md)** - Complete tutorial
- **[E2E Examples](e2e.md)** - Full workflow examples
- **[Contract Addresses](contract-addresses.md)** - Deployed contracts
- **[API Reference](../reference/api.md)** - Full API docs

### Get Help

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)

