# Mint USDST via CDP

Create USDST stablecoin by depositing collateral into a CDP (Collateralized Debt Position).

!!! info "Alternative: Borrow from Lending Pool"
    You can also **[borrow USDST from the lending pool](borrow.md)** which offers more flexibility but typically has higher interest rates.

!!! note "Variable Parameters"
    Stability fees, gas costs, and collateralization requirements shown are typical examples. Actual values may vary based on network conditions, asset type, and governance settings. Always check current parameters in the app before transacting.

---

## Complete Example: Mint $1,000 USDST

**Your situation:**

- You have: 1 ETHST in your wallet
- ETHST price: $3,000
- You need: $1,000 USDST long-term

**What you'll do:**

1. Deposit 1 ETHST into CDP vault
2. Mint 1,000 USDST
3. Use your USDST
4. Burn USDST to repay (anytime)
5. Withdraw your collateral

**Time needed:** 5 minutes  
**Total gas cost:** ~$0.30 (3 transactions)  
**Stability fee:** ~2-3% annually (lower than lending)

---

## CDP vs Lending: Which to Choose?

| Feature | CDP (Minting) | Lending Pool (Borrowing) |
|---------|---------------|--------------------------|
| **Action** | Mint new USDST | Borrow from pool |
| **Fees** | Stability fee (~2-3% annually) | Interest (~5% annually) |
| **Best for** | Long-term positions (months) | Short-term needs (days/weeks) |
| **Metric** | Collateralization Ratio (CR) | Health Factor |
| **Min Ratio** | 150% (varies by asset) | Depends on liquidation threshold |
| **Flexibility** | More capital efficient | Easier to manage |

**Choose CDP if:**

- ✅ You want lower fees
- ✅ Long-term position (months+)
- ✅ Maximizing capital efficiency
- ✅ Comfortable managing vaults

**Choose Lending if:**

- ✅ Short-term liquidity need
- ✅ Want simpler management
- ✅ Frequent changes to position
- ✅ See **[Borrow Guide](borrow.md)**

---

## Step 1: Deposit Collateral

**What you have:**

- 1 ETHST worth $3,000

**In the app:**

1. **Go to Advanced** (in sidebar) → **"Mint"** tab (Vaults sub-tab is default)
2. **In the Mint Widget:**
   - **Select collateral asset:** Choose **ETH**
   - **Enter deposit amount:** Type **1.0** (or click "Max")
   - Leave borrow amount empty for now
3. **Click the action button** (will show "Deposit")
   - Confirm in wallet (~$0.10 gas)
   - Approval + deposit happen automatically in one transaction
   - Wait 1-2 seconds

**Result:**
```
✅ Deposited: 1 ETHST ($3,000) into CDP vault
✅ Can mint up to: $2,000 USDST (150% min CR)
✅ Collateralization Ratio: N/A (no debt yet)
```

**Your wallet:**

- Before: 1 ETHST
- After: 0 ETHST (moved to CDP vault)

---

## Step 2: Mint USDST

**What you want:** Mint $1,000 USDST

**In the app:**

1. **Go to Advanced** (in sidebar) → **"Mint"** tab → Vaults sub-tab
2. **In the Mint Widget:**
   - Your existing collateral shows automatically
   - **Enter borrow amount:** Type **1000** USDST
3. **Review the preview:**

   - Minting: 1,000 USDST
   - New Collateralization Ratio: **300%** (Very safe ✓)
   - Stability Fee: ~2-3% annually
   - Min required CR: 150%
4. **Click "Mint USDST"**
   - Confirm in wallet (~$0.10 gas)
   - Wait 1-2 seconds

**Result:**
```
✅ Minted: 1,000 USDST (created new tokens)
✅ Collateralization Ratio: 300% (Very safe)
✅ Your wallet: +1,000 USDST
```

**Your position now:**

- Collateral: 1 ETHST ($3,000)
- Debt: 1,000 USDST
- Collateralization Ratio (CR): 300%
- Min required CR: 150%
- Still can mint: ~$1,000 more (but don't!)

**What is Collateralization Ratio?**
```
CR = (Collateral Value / Debt) × 100%
   = ($3,000 / $1,000) × 100% = 300%
```

- **Above 200%:** Very safe ✅
- **150-200%:** Moderate risk ⚠️
- **Below 150%:** Liquidation danger ❌

Your 300% CR means you have a huge safety buffer.

---

## Step 3: Use Your USDST

You now have 1,000 USDST to use for:

- ✅ Transaction fees on STRATO
- ✅ Swap for other tokens
- ✅ Provide liquidity
- ✅ Bridge to other chains
- ✅ Any other purpose

**Your debt grows slowly:**

- Stability fee: ~2-3% per year
- After 30 days: Owe ~$1,002
- After 1 year: Owe ~$1,025

**Lower fees than lending:**

- CDP: ~$2-3 per month on $1,000
- Lending: ~$4-5 per month on $1,000
- **Savings:** ~40% lower fees

---

## Step 4: Burn USDST (Repay Anytime)

**When you're ready** to close or reduce your position:

1. **Get USDST to burn:**

   - You might still have what you minted
   - Or swap other tokens for USDST
   - Or borrow from lending pool

2. **In the Mint Widget:**
   - **Enter repay amount:** How much USDST to burn
3. **Enter amount:**

   - Type specific amount (e.g., 1002 to close completely)
   - Or click **"Burn Max"** to burn all debt
4. **Click "Burn USDST"**
   - Confirm in wallet (~$0.10 gas)
   - Wait 1-2 seconds

**Result after full burn:**
```
✅ Burned: 1,002 USDST (destroyed tokens)
✅ Debt repaid: 1,000 principal + 2 stability fee
✅ CR: Infinite (no debt)
✅ Gas cost: ~$0.10
```

**Your position:**

- Collateral: 1 ETHST (still in vault)
- Debt: 0 USDST
- CR: No debt
- You can now withdraw collateral

---

## Step 5: Withdraw Collateral

**After burning all debt:**

1. **In your vault** (shown below the Mint Widget)
2. **Enter amount:** Type **1.0** (or click "Withdraw Max")
3. **Click "Withdraw"**
   - Confirm in wallet (~$0.10 gas)
   - Wait 1-2 seconds

**Result:**
```
✅ Withdrawn: 1 ETHST to your wallet
✅ Vault closed
```

**Final accounting:**

- You minted: 1,000 USDST
- You burned: 1,002 USDST
- Total cost: $2 stability fee + $0.30 gas = **$2.30 total**
- You still have: 1 ETHST (same as you started)

---

## What If Prices Change?

### Scenario: ETHST Drops to $2,200

**What happens:**

- Your collateral value: Now $2,200 (was $3,000)
- Your debt: Still 1,000 USDST (unchanged)
- Your CR: Drops to **220%** (still safe ✓)

**What to do:**

- **Option 1: Monitor** - Still above 150% minimum
- **Option 2: Add collateral** - Deposit more ETHST to increase CR
- **Option 3: Burn some debt** - Burn 200 USDST to boost CR

### Scenario: ETHST Drops to $1,600 (Danger!)

**What happens:**

- Your collateral value: Now $1,600
- Your debt: Still 1,000 USDST
- Your CR: **160%** (approaching minimum ⚠️)

**Danger zone:**

- CR below 150% = **you can be liquidated**
- Liquidators can take your collateral + 5-10% penalty
- You lose ETHST value beyond your debt

**What to do immediately:**

1. **Add more collateral** (safer), OR
2. **Burn some debt** (faster)
3. Keep CR above 200% for safety

**Best practice:** Keep CR **above 200%** for peace of mind.

---

## Managing Your Vault

### Check Your Vault

**In the app:**

- Go to **Advanced** (in sidebar) → **Mint** tab → **My Vaults**
- You'll see:

  - Collateral amount and value
  - Debt amount (with accrued fees)
  - Collateralization Ratio with indicator
  - Available to mint or withdraw

**CR indicators:**

- 🟢 **Green (> 200%):** Safe
- 🟡 **Yellow (150-200%):** Caution
- 🔴 **Red (< 150%):** Danger - liquidation risk

### Adding More Collateral

If CR drops:

1. Go to **Deposit**
2. Add more collateral
3. CR improves immediately

### Partial Burn

Don't need to burn all at once:

1. Go to **Burn**
2. Enter any amount
3. Reduces debt and improves CR

### Mint More USDST

If you need more USDST and have room:

1. Check current CR
2. If above 200%, can safely mint more
3. Go to **Mint** → Enter amount
4. CR will decrease

---

## Multiple Vaults

**You can have one vault per collateral type:**

**Example:**

- ETHST Vault: 2 ETHST deposited, 2,000 USDST minted
- WBTC Vault: 0.1 WBTC deposited, 3,000 USDST minted

**Each vault:**

- Has its own CR
- Is managed separately
- Can be liquidated independently

**Combined view:**

- Total collateral value: $10,000
- Total debt: 5,000 USDST
- Overall CR: 200%

---

## Tips & Best Practices

### DO ✅

- **Over-collateralize:** Keep CR above 200%
- **Monitor daily:** Check CR when prices move
- **Set alerts:** Use price alerts for your collateral
- **Long-term use:** CDP works best for months+ positions
- **Diversify vaults:** Spread across different collateral
- **Track fees:** Stability fees are lower but still accrue

### DON'T ❌

- **Min CR trap:** Don't mint at exactly 150% CR
- **Ignore warnings:** Yellow/red CR = take action
- **Forget fees:** Even 2-3% adds up over time
- **Mix up debt:** Track which vault has which debt
- **Panic close:** Can add collateral instead
- **Forget gas:** Keep USDST for fees

---

## Common Issues

### "Insufficient collateral"

**Problem:** Trying to mint more than your CR allows

**Solution:**

1. Deposit more collateral first, OR
2. Reduce the mint amount

---

### "Below debt floor"

**Problem:** Trying to mint less than minimum required debt

**Solution:**

- Each asset has minimum debt (e.g., 100 USDST)
- Mint at least that amount
- Or close vault completely by burning all

---

### "Would violate minimum CR"

**Problem:** This action would make your CR too low

**Solution:**

- If minting: Reduce amount or add collateral
- If withdrawing: Reduce amount or burn some debt
- Keep buffer above 150% minimum

---

### "Insufficient USDST balance"

**Problem:** Don't have enough USDST to burn

**Solution:**

1. Swap other tokens for USDST, OR
2. Borrow USDST from lending pool temporarily, OR
3. Burn a smaller amount now, rest later

---

### CR dropping

**Problem:** Your collateral value is decreasing

**Solution (act quickly):**

1. **Deposit more collateral** (safest)
2. **Burn some debt** (also good)
3. **Monitor closely** if still above 200%
4. **Don't wait** until you're near 150%

---

## Understanding Costs

### Stability Fees

**How fees work:**

- Fees accrue every second
- Typical rate: ~2-3% annually
- Lower than lending pool rates
- Compounds continuously

**Example costs:**
| Minted | Time | Fee Owed |
|--------|------|----------|
| $1,000 | 1 day | $0.08 |
| $1,000 | 1 week | $0.50 |
| $1,000 | 30 days | $2 |
| $1,000 | 1 year | $25 |
| $10,000 | 30 days | $20 |

**Compare to Lending:**
| Amount | Time | CDP Fee | Lending Interest | Savings |
|--------|------|---------|------------------|---------|
| $1,000 | 30 days | $2 | $4 | $2 (50%) |
| $1,000 | 1 year | $25 | $50 | $25 (50%) |
| $10,000 | 1 year | $250 | $500 | $250 (50%) |

### Gas Fees

| Action | Gas Cost |
|--------|----------|
| Deposit collateral | ~$0.10 |
| Mint USDST | ~$0.10 |
| Burn USDST | ~$0.10 |
| Withdraw collateral | ~$0.10 |

**Total for complete cycle:** ~$0.30-$0.40

---

## CDP vs Lending: Real Comparison

### Example: $10,000 Position for 6 Months

**CDP:**

- Collateral: 5 ETHST ($10,000)
- Minted: 5,000 USDST
- CR: 200%
- Stability fee: 2.5% annually
- Cost: $62.50 for 6 months

**Lending:**

- Collateral: 5 ETHST ($10,000)
- Borrowed: 5,000 USDST
- Health Factor: 1.2
- Interest: 5% annually
- Cost: $125 for 6 months

**Savings with CDP: $62.50 (50% less)**

---

## When to Use Each

### Use CDP (Minting) When:

✅ Long-term position (6+ months)  
✅ Want lowest fees  
✅ Maximizing capital efficiency  
✅ Comfortable managing CR  
✅ Planning to hold position  

**Example:** You want to mint USDST to provide liquidity for a year

### Use Lending (Borrowing) When:

✅ Short-term need (days/weeks)  
✅ Want simple management  
✅ Frequent position changes  
✅ Testing strategies  
✅ Need flexibility  

**Example:** You need USDST for a quick trade this week

---

## Advanced: Capital Efficiency

### Maximum Leverage Example

**Conservative (Recommended):**

- Deposit: 2 ETHST ($6,000)
- Mint: 2,000 USDST
- CR: 300%
- Very safe ✓

**Moderate:**

- Deposit: 1.5 ETHST ($4,500)
- Mint: 2,000 USDST
- CR: 225%
- Safe with buffer

**Aggressive (Not Recommended):**

- Deposit: 1.2 ETHST ($3,600)
- Mint: 2,000 USDST
- CR: 180%
- Risky - small price drop = danger

**Never go below 200% CR in volatile markets!**

---

## Next Steps

### Earn While You Have USDST

- **[Provide Liquidity](liquidity.md)** - Earn fees with your USDST
- **[Swap Tokens](swap.md)** - Trade for other assets
- **[Earn Rewards](rewards.md)** - Claim Reward Points for minting

### Learn More

- **[Core Concepts](../concepts.md)** - CR, liquidation, fees
- **[Safety Guide](../safety.md)** - Risk management
- **[FAQ](../faq.md)** - Common questions

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)
