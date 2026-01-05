# Swap Tokens

Trade tokens instantly using STRATO's decentralized exchange.

!!! note "Variable Parameters"
    Swap fees, gas costs, and exchange rates shown are typical examples. Actual values may vary based on network conditions, pool liquidity, and slippage. Always review the quote in the app before confirming swaps.

---

## Complete Example: Swap 1 ETH for USDC

**Your situation:**

- You have: 1 ETH
- ETH price: $3,000
- You want: USDC stablecoin

**What you'll do:**

1. Check swap quote
2. Execute swap
3. Receive USDC

**Time needed:** 2 minutes  
**Total cost:** ~$9 trading fee + $0.10 gas

---

### Quick Walkthrough

**Step 1: Get Quote**
- Go to **Swap** page
- From: **ETH** → Enter **1.0**
- To: **USDC**
- Quote shows: **2,991 USDC** (0.3% fee = $9)

**Step 2: Execute Swap**
- Click **"Swap"** (~$0.10 gas)
- Confirm in wallet
- Wait 1-2 seconds

**Result:**
```
✅ Swapped: 1 ETH → 2,991 USDC
✅ Rate: $2,991 per ETH (after fees)
✅ Cost: $9 trading fee + $0.10 gas
```

**Your wallet:**

- Before: 1 ETH, 0 USDC
- After: 0 ETH, 2,991 USDC

---

## Overview

**What is swapping?**
- Exchange one token for another (e.g., ETH → USDC)
- Instant execution through automated market makers (AMM)
- No order books or centralized intermediaries

**When to swap:**

- Convert assets to different tokens
- Take profits or rebalance portfolio
- Get USDST for transaction fees
- Enter/exit positions

---

## Prerequisites

Before swapping:

- [ ] STRATO account set up ([Quick Start Guide](../quick-start.md))
- [ ] Wallet connected to STRATO network
- [ ] Tokens in your wallet to swap
- [ ] Small amount of USDST for gas fees

---

## How Swapping Works

### Automated Market Maker (AMM)

STRATO uses liquidity pools instead of traditional order books:

1. **Liquidity pools** hold pairs of tokens (e.g., ETH-USDC pool)
2. **You swap** by trading with the pool
3. **Price determined** by pool's token ratio
4. **Liquidity providers** earn fees from your swap

**Price formula**: `Price = Token_B_Reserve / Token_A_Reserve`

### Fees

- **Trading fee**: ~0.3% of swap amount (goes to liquidity providers)
- **Gas fee**: < $0.10 in USDST (goes to network)

---

## Step-by-Step: Swap Tokens

### Step 1: Go to Swap Page

1. Navigate to **Swap** section in STRATO app
2. Ensure wallet is connected

### Step 2: Select Tokens

1. **From**: Select token you want to swap (source token)
2. **To**: Select token you want to receive (destination token)
3. Enter amount to swap

**Example**: Swap 1 ETH for USDC

### Step 3: Review Swap Details

The app displays:

- **Exchange rate**: Current price (e.g., 1 ETH = 3,000 USDC)
- **Price impact**: How much your trade affects the price (< 1% is good)
- **Minimum received**: Worst-case amount after slippage
- **Fees**: Trading fee + gas fee
- **Route**: Which pools the swap uses (may route through multiple)

### Step 4: Set Slippage Tolerance

**Slippage** = acceptable price movement during execution

- **Auto** (recommended): App chooses safe setting
- **0.1-0.5%**: Low slippage, may fail in volatile markets
- **1-2%**: Standard tolerance
- **3-5%**: High tolerance for volatile assets or large trades

!!! warning "Slippage Too High?"
    High slippage (> 5%) means:

    - Price impact is large
    - Pool liquidity is low
    - Consider smaller trade size or wait for better liquidity

### Step 5: Execute Swap

1. Click **Swap** button
2. Review transaction details in wallet popup
3. Confirm transaction
4. Wait for confirmation (~1-2 seconds)

✅ **Done!** New tokens appear in your wallet.

---

## Understanding Swap Output

### Price Impact

**What it is**: How much your trade moves the price

- **< 1%**: Good - minimal impact
- **1-3%**: Moderate - acceptable for most trades
- **> 3%**: High - consider smaller size or different route

**Why it matters**: Large trades in small pools = worse prices

### Slippage vs. Price Impact

- **Price Impact**: Price change due to your trade size
- **Slippage**: Additional price movement during execution

Both reduce your received amount.

### Routing

For optimal prices, swaps may route through multiple pools:

**Example**: ETH → CATA
- **Direct route**: ETH → CATA (if pool exists)
- **Routed**: ETH → USDC → CATA (better price through two swaps)

The app automatically finds the best route.

---

## Advanced Options

### Limit Slippage

Manually set maximum acceptable slippage:

1. Click settings icon
2. Choose slippage percentage
3. Transaction reverts if price moves beyond this

### Set Deadline

Transaction expires if not confirmed within deadline (default: 20 minutes).

Useful during high network congestion.

### Expert Mode

Enables:

- High slippage trades (> 5%)
- Multi-hop routes
- Advanced routing options

⚠️ **Use carefully** - higher risk of price manipulation.

---

## Best Practices

### Before Swapping

- [ ] Check price impact (< 3% preferred)
- [ ] Verify token addresses (avoid scam tokens)
- [ ] Start with small test swap
- [ ] Check sufficient USDST for gas

### During Swapping

- [ ] Review exchange rate makes sense
- [ ] Confirm token symbols are correct
- [ ] Check "minimum received" is acceptable
- [ ] Verify transaction details before confirming

### After Swapping

- [ ] Verify new token balance updated
- [ ] Check transaction on block explorer
- [ ] Monitor for confirmation

---

## Common Issues

### "Insufficient liquidity"

**Cause**: Not enough tokens in the pool

**Fix**:

- Reduce swap amount
- Try different token pair
- Wait for more liquidity
- Provide liquidity yourself ([Liquidity Guide](liquidity.md))

### "Price impact too high"

**Cause**: Your trade is too large for pool size

**Fix**:

- Split into smaller trades
- Wait for deeper liquidity
- Increase slippage tolerance (carefully)

### "Transaction failed" / Reverted

**Causes**:

- Price moved beyond slippage tolerance
- Insufficient USDST for gas
- Token approval not completed

**Fix**:

- Increase slippage slightly
- Get more USDST for gas
- Ensure approval transaction confirmed

---

## Tips for Best Prices

### 1. Check Multiple Pools

If multiple routes exist, the app chooses the best automatically. But verify:

- Compare expected output
- Check different token paths

### 2. Avoid Trading During Volatility

Prices fluctuate more during:

- Major news events
- Market dumps/pumps
- Low liquidity hours

### 3. Split Large Trades

Instead of one large swap:

- Split into 3-5 smaller swaps
- Reduces price impact
- Better average price

### 4. Monitor Gas Fees

Gas is cheap on STRATO (< $0.10), but:

- Multiple small swaps add up
- Balance gas cost vs. price impact savings

---

## What's Next?

### Provide Liquidity & Earn Fees

Earn from other traders' swaps:

→ **[Liquidity Guide](liquidity.md)** - Learn how to provide liquidity and earn trading fees

### Use Swaps in DeFi Strategies

- **Rebalance collateral**: Swap to optimize your collateral mix
- **Take profits**: Convert rewards to stablecoins
- **Enter positions**: Swap to needed tokens before borrowing

### Explore Other Features

- **[Borrow USDST](borrow.md)** - Get liquidity against collateral
- **[Mint via CDP](mint-cdp.md)** - Create USDST efficiently
- **[Earn Rewards](rewards.md)** - Claim CATA tokens

---

## Need Help?

- **FAQ**: [Common Questions](../faq.md#swaps-liquidity)
- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **API Reference**: [Interactive API (Swagger)](../reference/interactive-api.md)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)

