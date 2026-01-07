# Leverage Long Position

Amplify your exposure to an asset through recursive borrowing.

---

## ⚠️ High Risk Strategy

**WARNING:** This is an advanced, high-risk strategy.

- Can amplify gains AND losses
- Liquidation risk is significantly higher
- Only for experienced users
- Start small and understand the mechanics

---

## The Strategy

Use borrowed USDST to buy more of your collateral asset, creating leveraged exposure.

**How it works:**

1. Supply ETH as collateral
2. Borrow USDST against it
3. Swap USDST → more ETH
4. Supply new ETH as additional collateral
5. Repeat 2-3 times

**Result:** 2-3x exposure to ETH price movements (up AND down)

---

## Complete Example: 2x Leverage on 5 ETH

**Your starting position:**

- You have: 5 ETH ($15,000)
- ETH price: $3,000
- You believe: ETH will go up
- You want: 2x exposure (10 ETH equivalent)

**The play:**

- Round 1: Supply 5 ETH, borrow $7,500, buy 2.5 ETH
- Round 2: Supply 2.5 ETH, borrow $3,750, buy 1.25 ETH
- Total: 8.75 ETH position
- Debt: $11,250 USDST
- Leverage: ~1.75x

**Time needed:** 20 minutes  
**Risk level:** ⚠️ HIGH

---

## Step-by-Step Implementation

### Step 0: Understand the Risks (READ THIS!)

**What can go wrong:**

**If ETH drops 20%:**

- Without leverage: Lose $3,000 (20%)
- With 2x leverage: Lose $6,000 (40% of initial capital)
- Health factor drops significantly
- May face liquidation

**If ETH drops 30%:**

- Without leverage: Lose $4,500 (30%)
- With 2x leverage: Position likely LIQUIDATED
- Lose most/all of your collateral

**Only proceed if:**

- [ ] You understand liquidation mechanics
- [ ] You can monitor position daily
- [ ] You have funds to add collateral if needed
- [ ] You accept risk of total loss

---

### Step 1: Supply Initial Collateral (2 min)

1. Go to **Borrow** (in sidebar)
2. In Collateral Management table, find **ETH** → Click **"Supply"**
3. Enter amount: **5.0**
4. Click **"Supply"** (~$0.10 gas, approval automatic)

**Result:**
```
✅ Collateral: 5 ETH ($15,000)
✅ Can borrow: Up to $11,250 (75% LTV)
```

---

### Step 2: First Borrow (2 min)

**Borrow conservatively to start:**

1. Go to **Borrow** (in sidebar) → **Borrow** section
2. Amount: **7,500** USDST (50% of collateral value)
3. Review:

   - Health Factor: 1.6
   - Conservative start
4. Click **"Borrow"** (~$0.10 gas)

**Result:**
```
✅ Borrowed: 7,500 USDST
✅ Health Factor: 1.6
✅ Debt: 7,500 USDST
```

---

### Step 3: Swap USDST → ETH (2 min)

1. Go to **Swap Assets**
2. From: **USDST** → Amount: **7,500**
3. To: **ETH**
4. Review:

   - Receive: ~2.49 ETH (after 0.3% fee)
   - Rate: ~$3,009/ETH (including fee)
5. Click **"Swap"** (~$0.10 gas)

**Result:**
```
✅ Wallet: +2.49 ETH
✅ Total ETH owned: 7.49 (5 in collateral + 2.49 in wallet)
```

---

### Step 4: Supply New ETH (2 min)

**Add the new ETH to collateral:**

1. Go to **Borrow** (in sidebar)
2. In Collateral Management table, find **ETH** → Click **"Supply"**
3. Enter amount: **2.49**
4. Click **"Supply"** (approval automatic)

**Result:**
```
✅ Total collateral: 7.49 ETH ($22,470)
✅ Debt: 7,500 USDST
✅ Health Factor: 2.4 (improved!)
✅ Can borrow more: Up to $16,852
```

---

### Step 5: Second Borrow Round (2 min)

**Now borrow again:**

1. Go to **Borrow** (in sidebar) → **Borrow** section
2. Amount: **3,750** USDST (additional borrowing)
3. Check Health Factor: Will be ~1.6
4. Click **"Borrow"**

**Result:**
```
✅ Total debt: 11,250 USDST
✅ Health Factor: 1.6
✅ Can borrow: ~$5k more
```

---

### Step 6: Second Swap & Supply (4 min)

**Repeat the process:**

1. **Swap:** 3,750 USDST → ~1.24 ETH
2. **Supply:** 1.24 ETH to collateral

**Final Result:**
```
✅ Total collateral: 8.73 ETH ($26,190)
✅ Total debt: 11,250 USDST
✅ Health Factor: 1.86
✅ Leverage: 1.75x
```

---

## Your Leveraged Position

### Position Summary

**Starting capital:** 5 ETH ($15,000)

**Final position:**

- Collateral: 8.73 ETH ($26,190)
- Debt: 11,250 USDST
- Net value: $14,940 (slight loss from fees)
- ETH exposure: 8.73 ETH (vs 5 originally)
- **Leverage: 1.75x**

### Effective Exposure

**Price movement impact:**

| ETH Price Change | Your Gain/Loss | vs No Leverage |
|------------------|----------------|----------------|
| +10% | +$2,619 (17.5%) | +$1,500 (10%) |
| +20% | +$5,238 (35%) | +$3,000 (20%) |
| +50% | +$13,095 (87%) | +$7,500 (50%) |
| -10% | -$2,619 (17.5%) | -$1,500 (10%) |
| -20% | -$5,238 (35%) | -$3,000 (20%) |
| -30% | -$7,857 (52%) | -$4,500 (30%) |

**Amplification:** ~1.75x in both directions ⚠️

---

## Risk Management

### Critical Health Factor Levels

**Your HF: 1.86**

**Safe zones:**

- HF > 1.5: ✅ Safe, relax
- HF 1.3-1.5: ⚠️ Monitor daily
- HF 1.1-1.3: 🔴 Dangerous, add collateral soon
- HF < 1.1: 🚨 URGENT - liquidation imminent

### Price Drop Tolerance

**When liquidation hits:**

```
Health Factor = 1.0 at liquidation
Current HF = 1.86

Safe price drop = 46.2%
ETH can drop from $3,000 to ~$1,614
```

**Set price alerts:**

- Warning: $2,000 (-33%)
- Urgent: $1,800 (-40%)
- Critical: $1,700 (-43%)

### How to Respond to Drops

**If ETH drops 10% ($3,000 → $2,700):**

**Option 1: Add collateral**
- Supply more ETH or other assets
- Improves HF immediately
- Keep leverage

**Option 2: Repay debt**
- Repay 2,000-3,000 USDST
- Reduces risk
- Lower leverage

**Option 3: Partial exit**
- Sell 1 ETH for USDST
- Repay debt
- De-leverage partially

---

## Advanced: 3x Leverage (Extremely High Risk)

**⚠️⚠️⚠️ NOT RECOMMENDED FOR MOST USERS**

**To achieve ~3x leverage:**

1. Perform 4-5 rounds of borrow→swap→supply
2. Final position:

   - Collateral: ~15 ETH from 5 ETH start
   - Debt: ~$30,000 USDST
   - HF: ~1.1-1.2 (very risky)
3. Liquidation at 15-20% ETH drop

**Why this is dangerous:**

- Tiny drops = liquidation
- High interest costs
- Difficult to exit
- Slippage on large swaps

**If you must:**

- Use CDP instead (lower fees)
- Monitor every few hours
- Have exit plan ready
- Accept high probability of liquidation

---

## Cost Analysis

### Costs of Leverage

**One-time costs:**
| Item | Cost |
|------|------|
| Swaps (2 rounds × 0.3%) | ~$33 |
| Gas fees (6 transactions) | ~$0.60 |
| **Total initial** | **~$33.60** |

**Ongoing costs:**
| Item | Annual Cost |
|------|-------------|
| Interest (5% on $11.25k) | $562.50/year |
| **Monthly** | **~$47/month** |

### Break-even Analysis

**To profit after 1 year:**

ETH must rise > 3.75% to cover interest costs

**Example scenarios:**

- ETH +5%: Net gain ~$219 (1.5%)
- ETH +10%: Net gain ~$2,056 (14%)
- ETH +20%: Net gain ~$4,675 (31%)

**Without leverage (5 ETH):**

- ETH +5%: $750 gain (5%)
- ETH +10%: $1,500 gain (10%)
- ETH +20%: $3,000 gain (20%)

---

## Exit Strategy

### Taking Profits

**If ETH rises 50% ($3,000 → $4,500):**

**Your position:**

- Collateral: 8.73 ETH ($39,285)
- Debt: 11,250 USDST (unchanged)
- Net value: $28,035
- Profit: $13,035 (87% gain!)

**How to exit:**

1. **Sell some ETH:**

   - Withdraw 2.5 ETH from collateral
   - Swap → USDST
   - Receive ~$11,220

2. **Repay all debt:**

   - Repay 11,250 USDST
   - Zero debt

3. **Withdraw remaining collateral:**

   - Withdraw 6.23 ETH
   - Total ETH in wallet: 6.23
   - Plus any leftover USDST

**Final result:**

- Started: 5 ETH at $3,000 = $15,000
- Ended: 6.23 ETH at $4,500 = $28,035
- **Profit: $13,035 (87%)**
- vs no leverage: $7,500 (50%)

---

## Real Example: 90-Day Scenarios

### Scenario A: Bull Market 🚀

**ETH: $3,000 → $3,900 (+30%)**

| Metric | No Leverage | With Leverage |
|--------|-------------|---------------|
| Starting value | $15,000 | $15,000 |
| Ending value | $19,500 | $23,097 |
| Interest paid | $0 | $141 |
| Net profit | $4,500 (30%) | $7,956 (53%) |

**Leverage wins:** Extra $3,456 profit ✅

---

### Scenario B: Sideways Market ➡️

**ETH: $3,000 → $3,000 (0%)**

| Metric | No Leverage | With Leverage |
|--------|-------------|---------------|
| Starting value | $15,000 | $15,000 |
| Ending value | $15,000 | $14,859 |
| Interest paid | $0 | $141 |
| Net profit | $0 | -$141 |

**Leverage loses:** Bleed from interest ❌

---

### Scenario C: Bear Market 📉

**ETH: $3,000 → $2,400 (-20%)**

| Metric | No Leverage | With Leverage |
|--------|-------------|---------------|
| Starting value | $15,000 | $15,000 |
| Ending value | $12,000 | $9,702 |
| Interest paid | $0 | $141 |
| Net loss | -$3,000 (20%) | -$5,439 (36%) |

**Leverage amplifies loss:** Extra -$2,439 loss 🔴

---

## Tips for Success

### DO ✅

- Start with low leverage (1.5-2x max)
- Set strict price alerts
- Check position daily (multiple times if volatile)
- Have plan to add collateral or exit
- Take profits incrementally
- Use CDP for long-term (lower fees)

### DON'T ❌

- Go above 3x leverage (extremely risky)
- Leverage with money you can't lose
- Ignore health factor warnings
- Leverage in bear markets
- Add leverage when already down
- Forget about interest costs

---

## When to Use Leverage

### GOOD Times ✅

- Strong bull market momentum
- High conviction on price direction
- Low volatility environment
- You can monitor frequently
- Have capital to add if needed

### BAD Times ❌

- High market volatility
- Uncertain market direction
- Can't monitor regularly
- Already maxed out capital
- Bear market or downtrend

---

## Alternative: Leverage via CDP

**Better for long-term leverage:**

**Advantages:**

- Lower fees (2.5% vs 5%)
- Track CR instead of HF
- Better for multi-month positions

**Same risks:**

- Liquidation danger
- Amplified losses
- Interest costs

**Note:** Lending and CDP use separate collateral vaults - you cannot share the same collateral between both systems

---

## Troubleshooting

### "Can't borrow more - insufficient collateral"

**Problem:** Hit borrowing limit

**Fix:**

- Stop adding leverage
- Current position is max safe level
- Don't force it

### Health factor dropping fast

**Problem:** ETH price falling

**Urgent actions:**

1. Add collateral immediately
2. Or repay debt
3. Don't wait for liquidation

### High slippage on swaps

**Problem:** Large trade size

**Fix:**

- Split swaps into smaller sizes
- Wait between rounds
- Accept that max leverage is limited

---

## Summary

**Leverage amplifies everything:**

- ✅ Gains in bull markets
- ❌ Losses in bear markets
- 💰 Interest costs always apply
- ⚠️ Liquidation risk is real

**Use responsibly:**

- Low leverage (1.5-2x)
- High conviction only
- Strict risk management
- Have exit plan

---

## Next Steps

- **[Risk Management](risk-hedging.md)** - Hedge leveraged positions
- **[Exit Strategy](withdrawals.md)** - Close quickly if needed

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)

