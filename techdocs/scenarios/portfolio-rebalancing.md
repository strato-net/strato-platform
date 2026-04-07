# Portfolio Rebalancing

Diversify your collateral without closing positions or triggering taxable events.

---

## The Strategy

Rebalance your collateral mix while maintaining active positions on STRATO.

**Why rebalance:**

- Reduce concentration risk (too much in one asset)
- Optimize for better loan terms
- Adjust to market conditions
- Improve health factor/collateralization ratio

**Key benefit:** Keep your positions active, no need to exit and re-enter

---

## Complete Example: ETHST → Multi-Asset Portfolio

**Your starting position:**

- Collateral: 10 ETHST ($30,000) - 100% ETHST exposure
- Debt: 10,000 USDST borrowed
- Health Factor: 2.4
- Risk: High correlation to ETHST price

**Your goal:**

- Diversify to: 70% ETHST, 20% WBTCST, 10% stablecoins
- Maintain same debt
- Improve risk profile
- Keep positions open

**Time needed:** 20 minutes  
**Cost:** ~$0.60 in gas + swap fees

---

## Step-by-Step Implementation

### Step 1: Assess Current Position (2 min)

**Check your metrics:**

1. Go to **Borrow** (in sidebar)
2. Review:

   - Collateral: 10 ETHST ($30,000)
   - Debt: 10,000 USDST
   - Health Factor: 2.4
   - Max borrow: $18,000 (75% LTV)

**Calculate room to maneuver:**
```
Current borrowing: $10,000
Maximum safe borrowing: $18,000 (at HF 1.5)
Available room: $8,000
```

**Safe to proceed:** Yes, HF is very healthy

---

### Step 2: Decide Target Allocation (3 min)

**Target portfolio:**

- ETH: 70% = $21,000 = 7 ETHST
- BTC: 20% = $6,000 = 0.12 WBTCST (at $50k/BTC)
- Stablecoins: 10% = $3,000 = 3,000 USDST

**What needs to change:**
```
Current:

- ETHST: 10 ($30k)
- WBTCST: 0
- USDST: 0

Target:

- ETHST: 7 ($21k)
- WBTCST: 0.12 ($6k)
- USDST: 3,000 ($3k)

Action needed:

- Withdraw: 3 ETHST
- Swap: 3 ETHST → 0.12 WBTCST + 3k USDST
- Supply: WBTCST + USDST as collateral
```

---

### Step 3: Withdraw ETHST (2 min)

**Withdraw some ETHST to rebalance:**

1. Go to **Borrow** (in sidebar)
2. In Collateral Management table, find **ETHST** → Click **"Withdraw"**
3. Enter amount: **3.0**
4. Check impact:

   - New collateral: 7 ETHST ($21,000)
   - Health Factor: 1.68 ✅ (still safe)
5. Click **"Withdraw"** (~$0.10 gas)

**Result:**
```
✅ Collateral: 7 ETHST ($21,000)
✅ Debt: 10,000 USDST (unchanged)
✅ Health Factor: 1.68 (safe)
✅ Wallet: +3 ETHST ```

---

### Step 4: Swap ETHST → WBTCST (3 min)

**Convert ETHST to BTC:**

1. Go to **Swap Assets**
2. From: **ETH** → Amount: **2.0**
3. To: **WBTCST**
4. Review:

   - Receive: ~0.12 WBTCST (after 0.3% fee)
   - Value: ~$6,000
   - Price impact: < 1%
5. Click **"Swap"** (~$0.10 gas)

**Result:**
```
✅ Wallet: +0.12 WBTCST ($6,000)
✅ Remaining: 1 ETHST
```

---

### Step 5: Swap ETHST → USDST (3 min)

**Convert remaining ETHST to USDST:**

1. Go to **Swap Assets**
2. From: **ETHST** → Amount: **1.0**
3. To: **USDST**
4. Review:

   - Receive: ~$2,991 USDST (after 0.3% fee)
   - Price impact: < 1%
5. Click **"Swap"** (~$0.10 gas)

**Result:**
```
✅ Wallet: +2,991 USDST
✅ Ready to supply as collateral
```

---

### Step 6: Supply New Collateral (4 min)

**Add WBTCST collateral:**

1. Go to **Borrow** (in sidebar)
2. In Collateral Management table, find **WBTCST** → Click **"Supply"**
3. Enter amount: **0.12**
4. Click **"Supply"** (~$0.10 gas, approval automatic)

**Add USDST collateral:**

1. In Collateral Management table, find **USDST** → Click **"Supply"**
2. Enter amount: **2,991**
3. Click **"Supply"** (~$0.10 gas, approval automatic)

**Result:**
```
✅ New collateral composition:

- 7 ETHST ($21,000) = 70%
- 0.12 WBTCST ($6,000) = 20%
- 2,991 USDST ($3,000) = 10%
Total: $30,000 (same value)

✅ Total debt: 10,000 USDST (unchanged)
✅ Health Factor: 2.4 ✅
```

---

## Your Rebalanced Position

### Before Rebalancing

```
Collateral: 10 ETHST ($30k)
Debt: 10,000 USDST
HF: 2.4
Risk: 100% correlated to ETHST ```

### After Rebalancing

```
Collateral:

- 7 ETHST ($21k) = 70%
- 0.12 WBTCST ($6k) = 20%
- 2,991 USDST ($3k) = 10%
Total: $30,000

Debt: 10,000 USDST (unchanged)
HF: 2.4
Risk: Diversified across 3 assets
```

---

## Risk Analysis

### Risk Reduction

**Before:**

- ETHST drops 20% → Collateral = $24k → HF = 1.92 (moderate)
- Single point of failure

**After:**

- ETHST drops 20% → Only affects 70% of collateral
- WBTCST, USDST unaffected (or inverse correlation)
- Collateral = $26.8k ($21k→$16.8k ETHST, $6k WBTCST, $3k USDST)
- HF = 2.14 (safe)

**Improvement:** ~11% better HF in ETHST crash scenario

### Trade-offs

**Pros ✅:**

- Lower concentration risk
- Better stability in ETHST crashes
- USDST portion is uncorrelated
- Easier to manage volatility
- Same HF maintained (2.4)
- No additional debt or interest costs

**Cons ❌:**

- More assets to monitor
- Swap fees (~$0.60)
- Slightly less ETHST exposure (if ETHST pumps)

---

## Alternative Rebalancing Strategies

### Strategy 1: More Aggressive Rebalancing

**For even more diversification:**

- Withdraw 5 ETHST (not 3)
- Target: 50% ETHST, 30% WBTCST, 20% USDST
- Swap 5 ETHST → 0.2 WBTCST + 6k USDST

**Result:**

- Collateral: $30k (5 ETHST, 0.2 WBTCST, 6k USDST)
- Debt: $10k (unchanged)
- HF: 2.4 (same safety)
- More diversification

### Strategy 2: Gradual Rebalancing

**Spread over multiple days:**

- Day 1: Swap 25% of target
- Day 2: Another 25%
- Continue over 1 week
- Less price impact
- Can adjust if market moves

### Strategy 3: Opportunistic Rebalancing

**Wait for optimal conditions:**

- When ETHST pumps: Sell high
- When WBTCST dips: Buy low
- Use limit orders (if available)
- Maximize rebalancing profit

---

## Cost Breakdown

| Action | Cost |
|--------|------|
| Withdraw 3 ETHST | $0.10 |
| Swap 2 ETHST → WBTCST | $18 (0.3% of $6k) |
| Swap 1 ETHST → USDST | $9 (0.3% of $3k) |
| Supply WBTCST collateral | $0.10 |
| Supply USDST collateral | $0.10 |
| **Total** | **~$27.40** |

**No additional debt costs:**

- Debt unchanged at $10k
- No additional interest
- Only one-time swap fees

---

## Monitoring Your Rebalanced Portfolio

### Daily Checks

**Track all assets:**

1. ETHST price movements
2. WBTCST price movements
3. USDST stays at $1
4. Combined Health Factor

**Set alerts:**

- HF drops below 1.5 → Add collateral
- ETH/BTC ratio changes significantly → Consider rebalancing again

### When to Rebalance Again

**Trigger events:**

- One asset grows to >60% of portfolio
- Health factor deteriorates
- Better opportunities emerge
- Risk tolerance changes

**Recommended frequency:**

- Review: Weekly
- Rebalance: Quarterly or when >10% drift

---

## Advanced: Weighted by Volatility

**Optimal allocation based on risk:**

**Asset volatilities:**

- ETH: ~70% annual volatility
- BTC: ~60% annual volatility
- USDST: ~0% volatility

**Risk-weighted allocation:**

- USDST: 40% (stable, high weight)
- BTC: 35% (moderate volatility)
- ETH: 25% (high volatility, lower weight)

**Result:** Lower overall portfolio volatility

---

## Tax Considerations

**Rebalancing creates taxable events:**

- Swapping tokens = selling + buying
- Capital gains/losses realized
- Track cost basis for each asset
- Consult tax professional

**Tax-efficient approach:**

- Rebalance in tax-advantaged accounts (if possible)
- Harvest losses to offset gains
- Consider holding periods

---

## Real Example: 30-Day Results

**Starting position:**

- 10 ETHST collateral
- 10k USDST debt
- HF: 2.4

**After rebalancing:**

- 7 ETHST + 0.12 WBTCST + 3k USDST
- 10k USDST debt (unchanged)
- HF: 2.4

**Market moves over 30 days:**

- ETH: -15% (crash)
- BTC: +5% (resilient)
- USDST: $1 (stable)

**Result comparison:**

| Scenario | Old Portfolio | New Portfolio |
|----------|---------------|---------------|
| Collateral value | $25,500 | $26,700 |
| Health Factor | 1.53 | 1.60 |
| Loss | -$4,500 | -$3,300 |

**Saved: $1,200 due to diversification** ✅

---

## Troubleshooting

### "Can't withdraw ETHST - HF too low"

**Problem:** Trying to withdraw before adding other collateral

**Fix:**

1. Add WBTCST and USDST first
2. Then withdraw ETHST 3. Order matters!

### "Insufficient USDST for swaps"

**Problem:** Didn't borrow enough

**Fix:**

- Calculate total needed first
- Borrow with buffer (extra 5-10%)
- Can always repay excess

### "Swaps have high price impact"

**Problem:** Pools don't have enough liquidity

**Fix:**

- Split into smaller swaps
- Wait for more liquidity
- Use different pairs/routes

---

## Best Practices

### DO ✅

- Calculate target allocation before starting
- Add new collateral before withdrawing old
- Monitor HF after each step
- Keep safety buffer in debt capacity
- Document cost basis for taxes

### DON'T ❌

- Withdraw collateral first (risky)
- Over-leverage with new debt
- Rebalance too frequently (costs add up)
- Ignore tax implications
- Forget to monitor new assets

---

## Next Steps

### Further Optimization

- **[Risk Management](risk-hedging.md)** - Hedge your diversified portfolio
- **[Multi-Asset Strategy](multi-asset-strategy.md)** - Advanced multi-collateral approaches
- **[Collateral Optimization](collateral-optimization.md)** - Dynamic rebalancing

### Learn More

- **[Safety Guide](../safety.md)** - Managing diversified positions
- **[Swap Guide](../guides/swap.md)** - Deep dive on token swaps
- **[Lending Guide](../guides/borrow.md)** - Collateral management

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)

