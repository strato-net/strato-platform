# Dynamic Collateral Optimization

Continuously optimize your collateral mix based on market conditions for best risk/reward.

---

## The Strategy

Actively manage collateral composition to:

- Maximize borrowing capacity
- Minimize liquidation risk
- Optimize for fee generation
- Adapt to market conditions

**Key insight:** Not all collateral is created equal - different LTVs, volatilities, and correlations.

---

## Complete Example: Optimize 10 ETHST Position

**Your starting position:**

- Collateral: 10 ETHST ($30,000)
- Borrowed: 15,000 USDST
- LTV: 50%
- Health Factor: 1.6
- Risk: High (single asset)

**After optimization:**

- Collateral: 3 ETHST + 0.18 WBTCST + 12,000 USDCST ($30,000)
- Borrowed: 18,000 USDST
- LTV: 60%
- Health Factor: 1.37
- Risk: Medium (diversified)

**Improvement:** 

- ✅ Borrow $3k more (trade-off: slightly lower HF)
- ✅ Lower volatility portfolio (70% → 45%)
- ✅ Better risk-adjusted returns

---

## Understanding Collateral Types

### Collateral Parameters on STRATO

| Asset | LTV | Liq. Threshold | Volatility | Correlation to ETHST |
|-------|-----|----------------|------------|-------------------|
| **ETHST** | 75% | 80% | High (70%) | 1.0 (perfect) |
| **WBTCST** | 75% | 80% | High (65%) | 0.85 (high) |
| **USDCST** | 80% | 85% | None (0%) | 0.0 (none) |
| **USDTST** | 80% | 85% | None (0%) | 0.0 (none) |
| **GOLDST** | 70% | 75% | Moderate (40%) | 0.3 (low) |

**Key insights:**

1. Stablecoins have higher LTV (can borrow more)
2. But provide no price appreciation
3. Volatile assets have upside but more risk
4. Correlation matters for diversification

---

## Optimization Framework

### Step 1: Calculate Current Efficiency

**Metric: Risk-Adjusted Borrowing Capacity**

```
Current position:

- Collateral: 10 ETHST ($30k)
- Max borrow: $22,500 (75% LTV)
- Volatility: 70% (high)
- Sharpe-like ratio: $22,500 / 70% = 321

Target: Increase this ratio
```

---

### Step 2: Identify Optimal Mix

**Goal:** Maximize borrowing capacity per unit of risk

**Theory:** 

- More stables = higher LTV, lower vol
- Some volatile assets = upside exposure
- Uncorrelated assets = better diversification

**Optimal mix (depends on goals):**

**Conservative:**

- 40% volatile (ETHST+WBTCST)
- 60% stables
- Lower risk, less upside

**Moderate (recommended):**

- 60% volatile
- 40% stables
- Balanced risk/reward

**Aggressive:**

- 80% volatile
- 20% stables
- Higher upside, more risk

---

### Step 3: Execute Rebalancing

**For moderate allocation on $30k portfolio:**

**Target:**

- $18k volatile (60%)
  - $9k ETHST (3 ETHST)
  - $9k WBTCST (0.18 BTC)
- $12k stables (40%)
  - $12k USDCST

**From current (10 ETHST):**

1. **Remove 7 ETHST from collateral**
   - Temporarily reduces HF
   - Will fix by adding others

2. **Swap 4 ETHST → $12k USDCST**
   - Keep as stables

3. **Swap 3 ETHST → 0.18 WBTCST**
   - Diversify volatile holdings

4. **Supply new collateral:**

   - 3 ETHST
   - 0.18 WBTCST
   - 12,000 USDCST

**Result:**
```
New collateral: 3 ETHST + 0.18 WBTCST + 12k USDCST
Value: $30,000 (unchanged)
Max borrow: $23,100 (vs $22,500)
Volatility: ~45% (vs 70%)
Sharpe ratio: 513 (vs 321) ✅
```

**Can now borrow $600 more with lower risk!**

---

## Dynamic Optimization Rules

### Rule 1: Volatility Targeting

**Set target portfolio volatility (e.g., 50%):**

**If volatility exceeds target:**

1. Measure current vol (use price history)
2. Calculate over-exposure to volatile assets
3. Swap excess to stablecoins
4. Rebalance to hit target

**When to use:**

- During high market volatility
- When nervous about positions
- Before major events (Fed meetings, etc.)

---

### Rule 2: LTV Maximization

**Goal: Borrow maximum while staying safe**

**Calculate weighted LTV:**
```
Weighted LTV = Σ(Asset_Value × Asset_LTV) / Total_Value

Example:

- 3 ETHST ($9k) × 75% = $6,750
- 0.18 WBTCST ($9k) × 75% = $6,750
- 12k USDCST × 80% = $9,600
Total: $23,100 / $30k = 77% effective LTV

vs pure ETHST: 75% LTV
```

**Improvement: +2% borrowing capacity**

---

### Rule 3: Correlation Reduction

**Minimize correlated assets:**

**Bad diversification:**

- 50% ETHST
- 50% WBTCST
- Correlation: 0.85 (move together)
- Crash together in bear market

**Good diversification:**

- 30% ETHST
- 30% GOLDST
- 40% USDCST
- Correlations: 0.85, 0.0
- Better protected in crashes

**Formula:**
```
Portfolio_Variance = Σ(w_i² × σ_i²) + Σ(w_i × w_j × ρ_ij × σ_i × σ_j)

Minimize this by choosing low-correlation assets
```

---

## Market Condition Strategies

### Bull Market (Prices Rising)

**Optimize for:**

- Maximum upside exposure
- Higher volatile allocation
- Leverage if confident

**Target mix:**

- 80% ETHST + WBTCST - 20% stables (for stability)

**Why:**

- Capitalize on appreciation
- Stables provide safety net
- Can borrow more as collateral grows

---

### Bear Market (Prices Falling)

**Optimize for:**

- Capital preservation
- Reduce liquidation risk
- Increase stable allocation

**Target mix:**

- 40% ETHST + WBTCST (minimum exposure)
- 60% stables (protection)

**Why:**

- Reduce downside
- Higher LTV on stables lets you maintain debt
- Less chance of liquidation

---

### Sideways Market (Ranging)

**Optimize for:**

- Yield generation
- Balanced risk
- Fee optimization

**Target mix:**

- 60% volatile (some upside exposure)
- 40% stables (stability + higher LTV)

**Why:**

- Balanced position
- Can add leverage safely
- Focus on yield vs price action

---

## Advanced: Automated Rebalancing

### Set Rebalancing Triggers

**Volatility trigger:**
```
If portfolio_volatility > 60%:
    Sell 10% of volatile assets
    Buy stablecoins
    Rebalance monthly
```

**Drift trigger:**
```
If any asset > 50% of portfolio:
    Rebalance to target
    Max 5% drift tolerance
```

**Price trigger:**
```
If ETHST drops > 15%:
    Sell some ETHST
    Add stablecoins
    Protect from further drops
```

**Implementation:**

- Manual: Check weekly, rebalance monthly
- Semi-auto: Price alerts + manual action
- Fully auto: Smart contract + keeper bot (advanced)

---

## Cost-Benefit Analysis

### Rebalancing Costs

**Per rebalancing event:**

| Action | Cost |
|--------|------|
| Withdraw collateral | $0.10 |
| Swap fees (0.3% × amount) | $30-90 |
| Re-supply collateral | $0.30 |
| **Total** | **$30-100** |

**Frequency recommendations:**

| Portfolio Size | Rebalance Frequency | Annual Cost |
|----------------|---------------------|-------------|
| < $20k | Quarterly | $120-400 |
| $20k-$100k | Monthly | $360-1,200 |
| > $100k | Bi-weekly | $780-2,600 |

**Benefits must exceed costs!**

---

### When Rebalancing Pays Off

**Example:**

**Without rebalancing:**

- 10 ETHST position
- ETHST drops 30%
- Liquidated, lose 10% = $900

**With rebalancing (added stables):**

- Mixed collateral
- ETHST drops 30%
- Not liquidated
- Cost to rebalance: $50

**Net benefit: $850** ✅

**Rebalancing is insurance**

---

## Real Example: Portfolio Over 1 Year

**Starting (January):**

- 10 ETHST ($30k)
- 50% LTV
- Volatility: 70%

**Q1 (Bull market):**

- Optimized to 80% volatile, 20% stable
- Captured upside
- Grew to $38k

**Q2 (Volatility spike):**

- Rebalanced to 50% volatile, 50% stable
- Reduced risk
- Avoided liquidation in June crash

**Q3 (Bear market):**

- Further reduced to 30% volatile, 70% stable
- Preserved capital
- Value: $30k (vs $20k if stayed 100% ETHST)

**Q4 (Recovery):**

- Increased back to 60% volatile, 40% stable
- Positioned for recovery
- End value: $36k

**Result:**

- Started: $30k
- Ended: $36k (+20%)
- Without optimization: $25k (-17%)
- **Optimization added 37% relative gain**

---

## Optimization Checklist

### Monthly Review

- [ ] Calculate current allocation percentages
- [ ] Measure portfolio volatility
- [ ] Check asset correlations
- [ ] Compare to target allocation
- [ ] If drift > 10%, plan rebalance
- [ ] Check market conditions
- [ ] Adjust target if needed
- [ ] Execute rebalancing if warranted

### Quarterly Deep Dive

- [ ] Review all asset parameters (LTVs, etc.)
- [ ] Analyze 3-month performance
- [ ] Update target allocation
- [ ] Consider new assets
- [ ] Optimize debt structure
- [ ] Calculate rebalancing ROI
- [ ] Update strategy for next quarter

---

## Tools & Resources

### Portfolio Tracking

**Spreadsheet template:**
```
Columns:

- Asset
- Amount
- Price
- Value
- % of Portfolio
- Target %
- Drift
- Action Needed
```

**DeFi dashboards:**

- Zapper.fi
- DeBank
- Zerion
- Custom scripts

### Volatility Calculation

**Simple method:**

1. Download 30-day price history
2. Calculate daily returns
3. Standard deviation × √365
4. = Annual volatility

**Or use:**

- TradingView indicators
- Crypto volatility indexes
- Risk management tools

---

## When NOT to Optimize

### Skip Rebalancing If:

- [ ] Drift < 5% from target
- [ ] Rebalancing cost > expected benefit
- [ ] Major market event imminent (wait)
- [ ] Portfolio < $10k (not worth complexity)
- [ ] Already rebalanced this month
- [ ] Gas fees unusually high

**Don't over-optimize**

---

## Common Mistakes

### ❌ Rebalancing Too Often

**Problem:** Death by a thousand fees

**Fix:**

- Set minimum drift threshold (10%)
- Maximum frequency (monthly)
- Calculate if cost < benefit

### ❌ Chasing Past Performance

**Problem:** "BTC just pumped, let me add more"

**Fix:**

- Stick to target allocation
- Rebalance means selling winners
- Buy low, sell high

### ❌ Ignoring Correlations

**Problem:** "Diversified" into 5 correlated assets

**Fix:**

- Check correlation matrix
- True diversification = low correlation
- Include stables or negative correlation

---

## Summary

**Collateral optimization offers:**

- ✅ Higher borrowing capacity
- ✅ Lower portfolio volatility
- ✅ Better risk-adjusted returns
- ✅ Adaptive to market conditions
- ❌ Requires active management
- ❌ Ongoing rebalancing costs

**Best for:** Users with $20k+ portfolios willing to actively manage

**Key metric:** Risk-adjusted borrowing capacity

**Golden rule:** Rebalance when benefit > cost

---

## Next Steps

### Related Strategies

- **[Portfolio Rebalancing](portfolio-rebalancing.md)** - Execution guide
- **[Multi-Asset Strategy](multi-asset-strategy.md)** - Use multiple assets
- **[Risk Management](risk-hedging.md)** - Hedge your portfolio

### Learn More

- **[Safety Guide](../safety.md)** - Risk management
- **[Lending Guide](../guides/borrow.md)** - Collateral basics

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)

