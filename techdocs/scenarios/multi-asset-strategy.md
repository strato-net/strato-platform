# Multi-Asset DeFi Strategy

Use multiple collateral types and debt positions simultaneously for optimal capital efficiency.

---

## The Strategy

Combine different assets, both systems (Lending + CDP), and multiple income streams for maximum efficiency.

**What you'll use:**

- Multiple collateral types (ETH, BTC, stablecoins)
- Both Lending and CDP
- Liquidity provision
- Rewards optimization

**Result:** Maximum capital utilization + diversified income

---

## Complete Example: $50k Multi-Asset Position

**Your starting capital:**

- 5 ETHST ($15,000)
- 0.5 WBTCST ($25,000)
- 10,000 USDCST ($10,000)
- **Total:** $50,000

**Your goal:**

- Utilize all assets efficiently
- Generate multiple income streams
- Minimize fees
- Diversified risk

**Expected returns:** 8-12% annually

**Time needed:** 45 minutes to set up  
**Management:** 15 min/week

---

## Step-by-Step Implementation

### Phase 1: Supply All Collateral (10 min)

**Supply each asset type:**

1. **Supply 5 ETHST:**

   - Go to **Borrow** (sidebar)
   - In table, find ETHST → Click **"Supply"**
   - Enter: 5.0, Click **"Supply"** (~$0.10 gas)

2. **Supply 0.5 WBTCST:**

   - In table, find WBTCST → Click **"Supply"**
   - Enter: 0.5, Click **"Supply"** (~$0.10 gas)

3. **Supply 10,000 USDCST:**

   - In table, find USDCST → Click **"Supply"**
   - Enter: 10,000, Click **"Supply"** (~$0.10 gas)

**Result:**
```
✅ Total collateral: $50,000
- ETHST: $15,000 (30%)
- WBTCST: $25,000 (50%)
- USDCST: $10,000 (20%)

✅ Can borrow: Up to $37,500 (75% LTV)
```

---

### Phase 2: Strategic Borrowing (15 min)

**Use CDP for bulk position (lower fees):**

1. **Mint USDST via CDP:**

   - Go to **Advanced** (sidebar) → **Mint** tab
   - Mint: 18,000 USDST
   - CR: 278% (conservative)
   - Stability fee: 2.5%

**Use Lending for flexibility:**

2. **Borrow via Lending:**

   - Go to **Borrow** (sidebar) → **Borrow** section
   - Amount: 5,000 USDST
   - Interest: 5%
   - Total debt now: 23,000 USDST
   - Health Factor: 1.74

**Why split:**

- CDP: Lower fees for long-term
- Lending: Flexibility for short-term adjustments

**Result:**
```
✅ CDP debt: 18,000 USDST (2.5% fee)
✅ Lending debt: 5,000 USDST (5% fee)
✅ Total debt: 23,000 USDST
✅ Total collateral: $50,000
✅ Combined ratio: 217%
✅ Health Factor: 1.74
```

---

### Phase 3: Deploy to Income-Generating Activities (20 min)

**Strategy A: Liquidity Provision (60% of capital)**

1. **USDST-USDCST Pool ($12,000):**

   - Provide 6,000 USDST + 6,000 USDCST
   - Expected APR: 10% = $1,200/year
   - Low risk (stable-stable pair)

2. **ETHST-USDTST Pool ($6,000):**

   - Swap 2,000 USDST → 0.67 ETHST
   - Provide 0.67 ETHST + 2,000 USDTST
   - Expected APR: 15% = $900/year
   - Moderate risk (IL possible)

**Strategy B: Recursive Lending (20% of capital)**

3. **Supply borrowed USDST back:**

   - Supply 5,000 USDST to lending
   - Earn supply APY: 3% = $150/year
   - Partially offset borrow costs

**Strategy C: Hold as Safety Buffer (20%)**

4. **Keep 5,000 USDST in wallet:**

   - Emergency fund
   - Add collateral if needed
   - Opportunity capital

**Result:**
```
✅ Deployed capital:

- LP (USDST-USDCST): $12,000
- LP (ETHST-USDTST): $6,000
- Supplied USDST: $5,000
- Safety buffer: $5,000
Total: $28,000 deployed
```

---

## Your Complete Multi-Asset Position

### Assets Summary

**Collateral (in vault):**
```
5 ETHST: $15,000 (30%)
0.5 WBTCST: $25,000 (50%)
10,000 USDCST: $10,000 (20%)
Total: $50,000
```

**Debt:**
```
CDP: 18,000 USDST (2.5% fee)
Lending: 5,000 USDST (5% fee)
Total: 23,000 USDST
```

**Deployed:**
```
USDST-USDCST LP: $12,000 (10% APR)
ETHST-USDTST LP: $6,000 (15% APR)
Supplied USDST: $5,000 (3% APR)
Safety buffer: $5,000
```

---

## Income & Cost Analysis

### Annual Income

| Source | Amount | APR | Annual Income |
|--------|--------|-----|---------------|
| USDST-USDCST LP fees | $12,000 | 10% | $1,200 |
| ETHST-USDTST LP fees | $6,000 | 15% | $900 |
| Supply APY | $5,000 | 3% | $150 |
| Reward Points | All activities | Est | $800 |
| **Total Income** | | | **$3,050** |

### Annual Costs

| Cost | Amount | Rate | Annual Cost |
|------|--------|------|-------------|
| CDP stability fee | $18,000 | 2.5% | $450 |
| Lending interest | $5,000 | 5% | $250 |
| Gas fees | Est | - | $50 |
| **Total Costs** | | | **$750** |

### Net Profit

```
Annual income: $3,050
Annual costs: $750
Net profit: $2,300

Return on capital: 4.6% on $50k
```

**Plus:** Keep exposure to ETHST and WBTCST appreciation!

---

## Risk Assessment

### Diversification Score: High ✅

**Collateral:**

- 3 different assets
- Mix of volatile (ETHST, WBTCST) and stable (USDCST)
- Correlation: Partially hedged

**Income:**

- 4 different sources
- Not reliant on single pool
- Mix of risk levels

### Liquidation Risk: Moderate ⚠️

**Current metrics:**

- Combined CR: 217% (safe)
- Health Factor: 1.74 (safe)
- CDP CR: 278% (very safe)

**Safe price drops:**

- ETHST/WBTCST can drop ~20-25%
- USDCST stable
- Before liquidation risk

**Mitigation:**

- Safety buffer ready ($5k)
- Can add more collateral
- Can repay debt anytime

---

## Rebalancing Strategy

### Quarterly Rebalancing

**Check asset weightings:**

**Target allocation:**

- Volatile assets (ETH+BTC): 60-70%
- Stablecoins: 30-40%

**If ETH/BTC grow to 85%:**

1. Withdraw some volatile collateral
2. Swap to stablecoins
3. Add stablecoins as collateral
4. Rebalance back to 70/30

**If ETH/BTC drop to 45%:**

1. Remove some stable collateral
2. Swap to ETHST/WBTCST
3. Supply back as collateral
4. Maintain target allocation

---

## Optimization Techniques

### Technique 1: Interest Rate Arbitrage

**Monitor rates across systems:**

**If CDP stability fee drops to 2%:**

1. Mint more via CDP
2. Repay expensive Lending debt
3. Save on interest

**If Lending rates drop to 3%:**

1. Borrow more from Lending
2. Burn CDP debt
3. More flexibility

**Potential savings:** $50-200/year

---

### Technique 2: Yield Farming Optimization

**Switch LP positions based on APRs:**

**Current:** USDST-USDCST at 10% APR

**If USDST-USDTST pool offers 15%:**

1. Remove from USDST-USDCST
2. Swap to USDST-USDTST
3. Provide liquidity there
4. Extra $600/year

**Monitor weekly:**

- Check all pool APRs
- Factor in swap costs
- Move if > 3% APR difference

---

### Technique 3: Tax-Loss Harvesting

**Use multiple assets for tax efficiency:**

**Example:**

- ETHST up 50%: Unrealized gain
- WBTCST down 20%: Can harvest loss

**Strategy:**

1. Withdraw WBTCST collateral
2. Sell for USDCST (realize loss)
3. Buy back WBTCST after 30 days (avoid wash sale)
4. Offset ETHST gains with WBTCST loss

**Consult tax professional**

---

## Advanced: Leveraged Multi-Asset

**⚠️ Higher risk - experienced users only**

**Add leverage to multi-asset position:**

1. **Current:** $50k collateral, $23k debt (46% LTV)
2. **Borrow more:** Additional $10k
3. **Swap:** To ETHST + WBTCST 4. **Supply:** As additional collateral
5. **Result:** $60k collateral, $33k debt (55% LTV)

**Increases:**

- ✅ ETH/BTC exposure
- ✅ Potential returns
- ❌ Liquidation risk
- ❌ Interest costs

**Only do if:**

- Bullish on ETH/BTC
- Can monitor frequently
- Have emergency funds

---

## Managing Complexity

### Weekly Checklist (15 min)

**Monday morning routine:**

- [ ] Check Health Factor (keep > 1.3)
- [ ] Check CDP CR (keep > 200%)
- [ ] Review ETHST/WBTCST prices vs alerts
- [ ] Check LP positions (any IL?)
- [ ] Claim pending rewards
- [ ] Review pool APRs (any better options?)
- [ ] Check safety buffer level
- [ ] Update tracking spreadsheet

**Tools:**

- Spreadsheet or portfolio tracker
- Price alerts (TradingView, etc.)
- DeFi dashboard (Zapper, DeBank)

---

### Monthly Checklist (30 min)

- [ ] Detailed P&L calculation
- [ ] Rebalance if drift > 10%
- [ ] Optimize debt structure
- [ ] Harvest rewards and compound
- [ ] Review and adjust strategy
- [ ] Update cost basis for taxes
- [ ] Check for new opportunities

---

## Real Example: David's Multi-Asset Position

**Background:**

- $75k portfolio
- 8 ETHST + 1 WBTCST + $15k USDCST
- Ran for 6 months

**His strategy:**

- All assets as collateral
- $30k minted via CDP
- $10k borrowed via Lending
- $40k deployed to various LPs
- Safety buffer: $10k

**Results after 6 months:**

| Metric | Amount |
|--------|--------|
| Starting value | $75,000 |
| LP fees earned | $2,100 |
| Reward Points | $800 |
| Interest paid | -$600 |
| ETH/BTC appreciation | +$8,500 |
| **Ending value** | **$85,800** |
| **Total gain** | **$10,800 (14.4%)** |

**David's takeaway:**

- "More complex but worth it"
- "Diversification smoothed volatility"
- "Multiple income streams felt secure"

---

## Common Pitfalls

### ❌ Over-Complicating

**Problem:** Too many positions to track

**Fix:**

- Start simple (2-3 pools)
- Add complexity gradually
- Use tracking tools

### ❌ Ignoring Gas Costs

**Problem:** Frequent rebalancing eats profits

**Fix:**

- Rebalance quarterly, not weekly
- Calculate if savings > gas costs
- Batch transactions

### ❌ Chasing Yields

**Problem:** Moving to every new high-APR pool

**Fix:**

- Verify pool legitimacy
- Check liquidity depth
- Consider impermanent loss
- Stick with established pools

---

## When to Use Multi-Asset Strategy

### GOOD For ✅

- Large portfolios ($50k+)
- Diverse asset holdings
- Long-term positions
- Experienced DeFi users
- Active management tolerance

### NOT Ideal For ❌

- Small portfolios (< $10k)
- Single asset holders
- Set-and-forget preference
- DeFi beginners
- Low complexity tolerance

---

## Scaling Up

### $100k+ Portfolios

**Add:**

- More asset types (GOLDST, SILVST, etc.)
- More LP positions (5-7 pools)
- Cross-platform strategies
- Professional tax software
- Consider DeFi fund/DAO

### $500k+ Portfolios

**Consider:**

- Institutional platforms (Aave Arc, etc.)
- OTC desks for large swaps
- Professional portfolio management
- Tax and legal advisors
- Insurance products

---

## Exit Strategy

### Partial Exit

**If need $20k:**

1. Remove from LPs: $15k
2. Repay some debt: $10k
3. Withdraw collateral: $15k worth
4. Bridge to Ethereum if needed

**Keep rest of position active**

### Complete Exit

**See:** [Withdrawals Guide](withdrawals.md)

**Order:**

1. Remove all LP positions
2. Claim all rewards
3. Repay Lending debt (higher rate)
4. Burn CDP debt
5. Withdraw all collateral
6. Bridge out if needed

---

## Summary

**Multi-asset strategy offers:**

- ✅ Better diversification
- ✅ Multiple income streams
- ✅ Optimized fees (CDP + Lending)
- ✅ Flexibility
- ❌ More complexity
- ❌ More active management

**Best for:** Experienced users with $50k+ portfolios

---

## Next Steps

### Related Strategies

- **[Portfolio Rebalancing](portfolio-rebalancing.md)** - Maintain allocations
- **[Maximize Yield](maximize-yield.md)** - Focus on income

### Learn More

- **[Risk Management](risk-hedging.md)** - Hedge complex positions
- **[Safety Guide](../safety.md)** - Manage multiple assets

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)

