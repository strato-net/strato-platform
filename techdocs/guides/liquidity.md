# Provide Liquidity

Earn fees by providing liquidity to STRATO's decentralized exchange pools.

!!! note "Variable Returns & Risks"
    APR estimates, gas costs, and trading fees shown are based on historical data and typical conditions. Actual returns may vary significantly based on trading volume, pool size, and market conditions. You may also experience impermanent loss. Always research pool performance before providing liquidity.

---

## Complete Example: Provide $6,000 ETHST-USDCST Liquidity

**Your situation:**

- You have: 1 ETHST ($3,000) + 3,000 USDCST
- You want: Earn trading fees passively

**What you'll do:**

1. Choose ETHST-USDCST pool
2. Add liquidity
3. Earn fees automatically
5. Remove liquidity (anytime)

**Time needed:** 5 minutes  
**Potential earnings:** ~8-15% APR (fees + Reward Points)  
**Total gas cost:** ~$0.30

---

### Quick Walkthrough

**Step 1: Choose Pool**
- Go to **Pools** page
- Select **ETHST-USDCST pool**
- Check: 24h volume $500k, APR 12%

**Step 2: Enter Amounts**
- Enter: **1 ETHST**
- Auto-fills: **3,000 USDCST** (to match ratio)
- Your share: 0.5% of pool

**Step 3: Add Liquidity**
- Click **"Add Liquidity"** (~$0.10 gas)
- Confirm in wallet
  - Approvals + add liquidity happen automatically in one transaction
- Wait 1-2 seconds

**Result:**
```
✅ Added: 1 ETHST + 3,000 USDCST to pool
✅ Received: LP tokens (representing your 0.5% share)
✅ Earning: ~$2/day in fees (12% APR)
✅ Plus: Reward Points
```

**Your position:**

- Pool share: 0.5%
- Value: $6,000
- Daily earnings: ~$2 in fees
- Monthly: ~$60 (if volume stays constant)

---

## Overview

**What is liquidity providing?**
- Deposit token pairs into liquidity pools (e.g., ETHST + USDC)
- Earn trading fees from every swap that uses your pool
- Receive LP (Liquidity Provider) tokens representing your share
- Plus earn Reward Points

**Why provide liquidity?**
- **Passive income**: Earn from trading fees (typically 0.3% per trade)
- **Reward Points**: Bonus rewards for liquidity providers
- **Support ecosystem**: Enable trading for others
- **Capital efficiency**: Put idle assets to work

---

## Prerequisites

Before providing liquidity:

- [ ] STRATO account set up ([Quick Start Guide](../quick-start.md))
- [ ] Wallet connected to STRATO network
- [ ] Both tokens of a pair in your wallet (e.g., ETHST + USDC)
- [ ] Small amount of USDST for gas fees
- [ ] Understanding of impermanent loss ([Core Concepts](../concepts.md#impermanent-loss-liquidity-provision))

---

## How Liquidity Pools Work

### Automated Market Maker (AMM)

1. **You deposit** equal value of two tokens (e.g., $1,000 ETHST + $1,000 USDC)
2. **Traders swap** between these tokens, paying fees
3. **You earn** a share of fees proportional to your pool share
4. **You can withdraw** anytime (subject to available liquidity)

### Pool Math

Pools maintain a constant product:

```
x × y = k (constant)

Where:
x = Token A reserves
y = Token B reserves  
k = constant product
```

This formula automatically sets prices based on supply and demand.

### Your Share

You receive **LP tokens** representing your ownership:

```
Your LP tokens / Total LP tokens = Your % of pool
```

**Example**: You own 1,000 LP tokens, total is 100,000 LP tokens
- Your share: 1%
- You earn: 1% of all trading fees

---

## Step-by-Step: Add Liquidity

### Step 1: Choose a Pool

1. Navigate to **Pools** section in STRATO app
2. Browse available pools or search for specific pair
3. Check pool stats:

   - **TVL (Total Value Locked)**: Pool size
   - **Volume 24h**: Trading activity
   - **APR**: Estimated annual returns (fees + rewards)

**Popular pools**:

- ETHST / USDCST - High volume, stable
- WBTC / ETHST - Dual crypto exposure
- USDCST / USDST - Minimal impermanent loss

### Step 2: Enter Amounts

1. Click **Add Liquidity** on chosen pool
2. Enter amount for one token
3. Second token amount auto-fills to maintain pool ratio

**Example**:

- Pool is 50% ETHST, 50% USDCST
- You enter: 1 ETHST ($3,000)
- Auto-fills: 3,000 USDCST (to match value)

!!! tip "Start Small"
    Test with ~$100-500 first to understand the process before committing large amounts.

### Step 3: Review Details

Check:

- **Token amounts**: Both tokens and their USD values
- **Pool share**: Your % of total pool
- **Exchange rate**: Current price in pool
- **Estimated APR**: Expected annual returns
- **Fees**: Gas cost (< $0.10 in USDST)

### Step 4: Add Liquidity

1. Click **Add Liquidity**
2. Review transaction in wallet popup
3. Confirm transaction
4. Wait for confirmation (~1-2 seconds)

✅ **Done!** You now have LP tokens in your wallet.

---

## Earning from Liquidity

### Trading Fees

**How you earn**:

- Every swap pays 0.3% fee (typical)
- Fees distributed proportionally to all LP holders
- Automatically added to pool (compounds)

**Example**:

- You own 1% of ETH-USDC pool
- Pool does $1,000,000 daily volume
- Daily fees: $1,000,000 × 0.3% = $3,000
- Your share: $3,000 × 1% = $30/day

### Reward Points

Additional rewards in Reward Points:

- Distributed to select pools
- Varies by pool and season
- Claim anytime in Rewards section

### Tracking Earnings

Monitor your position:

1. Go to **Advanced** (in sidebar) → **Swap Pools** tab
2. See your LP positions
3. View accumulated fees
4. Check current value vs. initial deposit

---

## Removing Liquidity

### Step 1: Go to Your Positions

1. Navigate to **Portfolio** → **Liquidity**
2. Select pool to withdraw from

### Step 2: Choose Amount

- **Remove All**: Withdraw 100% of position
- **Partial**: Enter % or amount to withdraw
- Receive both tokens proportionally

### Step 3: Confirm Withdrawal

1. Click **Remove Liquidity**
2. Review amounts you'll receive
3. Confirm transaction in wallet
4. Wait for confirmation

Tokens (including earned fees) return to your wallet.

---

## Understanding Impermanent Loss

### What Is It?

**Impermanent Loss (IL)**: Loss vs. simply holding the tokens when prices diverge.

### Example

**Initial deposit**:

- 1 ETHST ($3,000) + 3,000 USDCST = $6,000 total

**ETH doubles to $6,000**:

- Pool rebalances: 0.707 ETHST + 4,242 USDCST - Pool value: $8,485
- If you just held: 1 ETHST ($6,000) + 3,000 USDCST = $9,000
- **Impermanent loss: $515 (5.7%)**

### When Is It a Problem?

- **High IL**: When token prices diverge significantly
- **Low IL**: Stablecoin pairs (USDC-USDST) or correlated assets

### Mitigating IL

1. **Choose stable pairs**: USDC-USDST has minimal IL
2. **Earn fees to offset**: High-volume pools compensate with fees
3. **Long-term provide**: Price often reverts, making loss "impermanent"
4. **Reward Points**: Additional rewards can exceed IL

!!! note "IL is Impermanent"
    Loss only realizes if you withdraw. If prices revert, the "loss" disappears. Plus trading fees and rewards often exceed IL.

---

## Best Practices

### Choosing Pools

**Good pools have**:

- ✅ High trading volume (more fees earned)
- ✅ Deep liquidity (lower IL from your deposits)
- ✅ Verified tokens (avoid scams)
- ✅ Reward Points incentives

**Avoid pools with**:

- ❌ Unknown/unverified tokens
- ❌ Extremely low liquidity
- ❌ Suspicious APR (too good to be true)

### Managing IL Risk

**Low IL strategies**:

- Stablecoin pairs (USDC-USDST, USDC-DAI)
- Correlated assets (WBTC-ETH move together)
- Short time horizons in stable markets

**Higher IL but profitable**:

- High-volume pairs (fees offset IL)
- Pools with Reward Points
- Long-term positions (price reverts)

### Position Management

- [ ] Monitor positions weekly
- [ ] Check if fees exceed IL
- [ ] Rebalance between pools based on APR
- [ ] Claim Reward Points regularly
- [ ] Withdraw if IL becomes too large

---

## Pool Stats Explained

### TVL (Total Value Locked)

Total $ value in the pool. Higher = more stable prices, lower price impact.

### Volume 24h

Total trading volume in last 24 hours. Higher = more fees earned.

### APR (Annual Percentage Rate)

Estimated yearly returns from:

- Trading fees
- Reward Points

**Example**: 25% APR on $10,000 = ~$2,500/year

!!! warning
    APR is estimated based on recent activity. Actual returns vary with volume and prices.

### Your Pool Share

Your % of total pool. Determines your fee earnings:

```
Your fees = Total pool fees × Your share %
```

---

## Advanced Strategies

### Liquidity Farming

Maximize returns by:

1. Choose highest APR pools
2. Reinvest earned fees (compound)
3. Claim and reinvest Reward Points
4. Rotate to best-performing pools

### Range Orders (Concentrated Liquidity)

Some pools support concentrated liquidity:

- Provide liquidity in specific price ranges
- Earn more fees per capital
- Higher risk if price exits range

**Not yet available on all STRATO pools** - check pool type.

### Arbitrage Protection

Be aware of:

- Price discrepancies between exchanges
- Arbitrageurs quickly correct, earning fees from your pool
- You still earn fees, but IL can occur rapidly

---

## Common Issues

### "Insufficient Balance"

**Cause**: Not enough of one or both tokens

**Fix**:

- Check you have both tokens
- Verify balances cover amounts + gas
- Swap to get missing token

### "Price Updated" Warning

**Cause**: Pool ratio changed since you started

**Fix**:

- Accept new price
- Or cancel and try again with updated amounts

### "Slippage Tolerance Exceeded"

**Cause**: Pool price moved beyond tolerance

**Fix**:

- Increase slippage in settings
- Try again with updated amounts

---

## Risk Management

### Diversification

- Don't put all capital in one pool
- Split across 3-5 pools
- Mix stable and volatile pairs

### Start Small

- Test with $100-500 first
- Learn the mechanics
- Scale up gradually

### Monitor Regularly

- Check positions weekly
- Compare returns vs. holding
- Exit if IL exceeds comfort level

### Emergency Exit

If you need to exit quickly:

- Remove liquidity anytime
- Receive both tokens back
- May realize impermanent loss
- But you keep all earned fees

---

## What's Next?

### Claim Your Rewards

Maximize earnings:

→ **[Rewards Guide](rewards.md)** - Learn to claim Reward Points

### Optimize Your Portfolio

- **[Swap Guide](swap.md)** - Rebalance between pools
- **[Borrow USDST](borrow.md)** - Leverage your LP positions
- **[Core Concepts](../concepts.md)** - Deepen your understanding

---

## Need Help?

- **FAQ**: [Common Questions](../faq.md#swaps-liquidity)
- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **API Reference**: [Interactive API (Swagger)](../reference/interactive-api.md)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)

