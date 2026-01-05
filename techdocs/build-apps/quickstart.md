# Developer Quick Start

Get up and running with STRATO in 5 minutes.

---

## 1. Setup (2 minutes)

### Install Dependencies

```bash
npm install ethers dotenv
```

### Environment Variables

Create `.env`:

```bash
# STRATO RPC
RPC_URL=https://app.strato.nexus/strato-api/eth/v1.2

# Your wallet private key (NEVER commit this!)
PRIVATE_KEY=your_private_key_here

# App API (optional, for higher-level DeFi operations)
APP_API=https://app.strato.nexus/api
```

---

## 2. Connect to STRATO (1 minute)

```javascript
require('dotenv').config();
const { ethers } = require('ethers');

// Connect to STRATO
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

// Create wallet
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

console.log('Connected! Address:', wallet.address);

// Check balance
const balance = await provider.getBalance(wallet.address);
console.log('Balance:', ethers.formatEther(balance), 'ETH');
```

---

## 3. Your First Transaction (2 minutes)

### Example: Supply Collateral to Lending Pool

```javascript
const { ethers } = require('ethers');

// Contract addresses (mainnet)
const LENDING_POOL = '0x...'; // LendingPool address
const ETH_TOKEN = '0x...';     // WETH address

// ABIs (simplified)
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)'
];

const LENDING_POOL_ABI = [
  'function supplyCollateral(address asset, uint256 amount)'
];

async function supplyCollateral() {
  // Connect
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  // Contract instances
  const ethToken = new ethers.Contract(ETH_TOKEN, ERC20_ABI, wallet);
  const lendingPool = new ethers.Contract(LENDING_POOL, LENDING_POOL_ABI, wallet);
  
  // Amount to supply (1 ETH)
  const amount = ethers.parseEther('1.0');
  
  // Step 1: Approve
  console.log('Approving...');
  const approveTx = await ethToken.approve(LENDING_POOL, amount);
  await approveTx.wait();
  console.log('✅ Approved');
  
  // Step 2: Supply
  console.log('Supplying collateral...');
  const supplyTx = await lendingPool.supplyCollateral(ETH_TOKEN, amount);
  await supplyTx.wait();
  console.log('✅ Supplied 1 ETH as collateral');
}

supplyCollateral().catch(console.error);
```

**Result:**
```
Approving...
✅ Approved
Supplying collateral...
✅ Supplied 1 ETH as collateral
```

---

## Next Steps

### Learn More

- **[Contract Addresses](contract-addresses.md)** - All deployed contracts
- **[API Integration Guide](integration.md)** - Complete walkthrough
- **[Quick Reference](quick-reference.md)** - Common operations
- **[E2E Examples](e2e.md)** - Full example flows

### Common Operations

- **[Borrow USDST](quick-reference.md#lending-operations)** - Get liquidity
- **[Swap Tokens](quick-reference.md#swap-operations)** - Trade on DEX
- **[Provide Liquidity](quick-reference.md#liquidity-operations)** - Earn fees
- **[Bridge Assets](quick-reference.md#bridge-operations)** - Cross-chain transfers

### Get Help

- **[API Reference](../reference/api.md)** - Full API docs
- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)

---

## Complete Example: Borrow USDST

```javascript
const { ethers } = require('ethers');
require('dotenv').config();

// Contract addresses
const LENDING_POOL = '0x...';
const COLLATERAL_VAULT = '0x...';
const ETH_TOKEN = '0x...';
const USDST_TOKEN = '0x...';

// ABIs
const ERC20_ABI = ['function approve(address,uint256) returns(bool)'];
const VAULT_ABI = ['function addCollateral(address,uint256)'];
const POOL_ABI = ['function borrow(address,uint256)'];

async function borrowUSDST() {
  // Setup
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  const ethToken = new ethers.Contract(ETH_TOKEN, ERC20_ABI, wallet);
  const vault = new ethers.Contract(COLLATERAL_VAULT, VAULT_ABI, wallet);
  const pool = new ethers.Contract(LENDING_POOL, POOL_ABI, wallet);
  
  // Amounts
  const collateralAmount = ethers.parseEther('1.0');  // 1 ETH
  const borrowAmount = ethers.parseEther('500');       // 500 USDST
  
  try {
    // 1. Approve ETH to vault
    console.log('1. Approving ETH...');
    let tx = await ethToken.approve(COLLATERAL_VAULT, collateralAmount);
    await tx.wait();
    console.log('   ✅ Approved');
    
    // 2. Add collateral
    console.log('2. Adding collateral...');
    tx = await vault.addCollateral(ETH_TOKEN, collateralAmount);
    await tx.wait();
    console.log('   ✅ Added 1 ETH collateral');
    
    // 3. Borrow USDST
    console.log('3. Borrowing USDST...');
    tx = await pool.borrow(USDST_TOKEN, borrowAmount);
    await tx.wait();
    console.log('   ✅ Borrowed 500 USDST');
    
    console.log('\n✅ Success! Check your wallet for USDST.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

borrowUSDST();
```

---

## Debugging Tips

### Check Transaction Status

```javascript
const receipt = await tx.wait();
console.log('Status:', receipt.status); // 1 = success, 0 = failed
console.log('Gas used:', receipt.gasUsed.toString());
console.log('Block:', receipt.blockNumber);
```

### Handle Errors

```javascript
try {
  const tx = await contract.someFunction();
  await tx.wait();
} catch (error) {
  if (error.code === 'INSUFFICIENT_FUNDS') {
    console.error('Not enough gas');
  } else if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
    console.error('Transaction will likely fail');
  } else {
    console.error('Error:', error.message);
  }
}
```

### Estimate Gas Before Sending

```javascript
try {
  const gasEstimate = await contract.someFunction.estimateGas(param1, param2);
  console.log('Estimated gas:', gasEstimate.toString());
  
  // Now send with confidence
  const tx = await contract.someFunction(param1, param2, {
    gasLimit: gasEstimate * 120n / 100n // Add 20% buffer
  });
} catch (error) {
  console.error('This transaction would fail:', error);
}
```

---

## Production Checklist

Before going live:

- [ ] Never commit private keys
- [ ] Use environment variables for secrets
- [ ] Test on testnet first
- [ ] Implement proper error handling
- [ ] Add transaction retry logic
- [ ] Monitor gas prices
- [ ] Set reasonable timeouts
- [ ] Log all transactions
- [ ] Implement rate limiting
- [ ] Add health checks

---

## Next Steps

**Ready to build!** 🚀

- **[Interactive API Reference](../reference/interactive-api.md)** - Explore the complete API with Swagger UI
- **[Quick Reference](quick-reference.md)** - Code snippets for all operations
- **[API Integration Guide](integration.md)** - Complete integration walkthrough
- **[E2E Examples](e2e.md)** - Full end-to-end integration examples

