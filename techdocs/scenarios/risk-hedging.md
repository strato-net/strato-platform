# Risk Management & Hedging

Protect your DeFi positions from market volatility and liquidation risk.

---

## The Strategy

Use stablecoins and diversification to hedge against collateral price drops while maintaining DeFi positions.

**What you'll learn:**

- Hedge collateral volatility
- Reduce liquidation risk
- Maintain upside exposure
- Balance risk and return

**Result:** Sleep better while staying in DeFi

---

## Complete Example: Hedge 10 ETHST Position

**Your situation:**

- Collateral: 10 ETHST ($30,000)
- Borrowed: 16,000 USDST
- Health Factor: 1.5
- **Problem:** Worried about ETHST crash

**The hedge:**

1. Mint additional USDST via CDP
2. Swap portion to stablecoins
3. Hold as safety buffer
4. If ETHST drops: Use stables to add collateral

**Time needed:** 10 minutes  
**Cost:** ~$0.50 gas + swap fees

---

## Understanding DeFi Risks

### Primary Risks

**1. Collateral Volatility**
- ETHST drops 30% → Health factor plummets
- Risk: Liquidation

**2. Interest Rate Changes**
- Borrow rates spike during volatility
- Debt grows faster

**3. Smart Contract Risk**
- Platform exploits (rare but possible)
- Mitigation: Audited contracts, insurance

**4. Liquidation Cascade**
- Market-wide selloff
- Mass liquidations drive prices lower

---

## Hedging Strategy 1: Stable Collateral Mix

**Mix volatile and stable collateral**

### Implementation

**Starting:**

- 10 ETHST ($30,000) = 100% volatile

**Target:**

- 6 ETHST ($18,000) = 60% volatile
- 12,000 USDCST ($12,000) = 40% stable

**Steps:**

1. **Mint USDST via CDP:**

   - Mint 6,000 USDST (low CR)
   - Stability fee: 2.5%

2. **Swap to stablecoins:**

   - Swap 6,000 USDST → USDCST
   - Cost: ~$18 (0.3% fee)

3. **Supply USDCST as collateral:**

   - Add 6,000 USDCST to collateral
   - Now have mixed collateral

4. **Optional - Remove some ETH:**

   - Withdraw 2 ETHST    - Sell or hold separately
   - Keep 8 ETHST + 6,000 USDCST collateral

**Result:**
```
Before:

- 10 ETHST collateral
- 16,000 USDST debt
- HF: 1.5
- Risk: High (100% ETHST exposure)

After:

- 8 ETHST + 6,000 USDCST collateral
- 22,000 USDST debt (16k original + 6k new)
- HF: 1.09
- Risk: Lower (60% ETHST, 40% stable)
```

### Impact Analysis

**If ETHST drops 25%:**

**Without hedge:**

- Collateral: $22,500 (10 ETHST @ $2,250)
- Debt: 16,000
- HF: 1.12 (safe)

**With hedge:**

- Collateral: $24,000 (8 ETHST @ $2,250 + 6k USDCST)
- Debt: 22,000
- HF: 0.87 (liquidated!)

**Wait, that's worse!** Need to adjust...

---

## Hedging Strategy 2: Safety Buffer (Better)

**Hold stablecoins OUTSIDE collateral as emergency fund**

### Implementation

**Step 1: Create Safety Buffer**

1. **Mint USDST via CDP:**

   - Use 10 ETHST collateral
   - Mint 7,000 USDST
   - CR: 286% (safe)

2. **Swap to stablecoins:**

   - Swap to 7,000 USDCST    - Hold in wallet (NOT as collateral)

3. **Keep borrowing position:**

   - 10 ETHST collateral
   - 16,000 borrowed + 7,000 minted = 23,000 debt
   - HF: 1.04 (safe with buffer ready!)

**Result:**
```
Collateral: 10 ETHST ($30,000)
Debt: 23,000 USDST
HF: 1.04
Safety buffer: 7,000 USDCST in wallet
```

### Using the Safety Buffer

**If ETHST drops 25% ($3,000 → $2,250):**

1. **Without buffer:**

   - Collateral: $22,500
   - Debt: 23,000
   - HF: 0.78 → LIQUIDATED ❌

2. **With buffer:**

   - Use 7,000 USDCST from wallet
   - Swap → 3.11 ETHST (at $2,250)
   - Supply as collateral
   - New collateral: 13.11 ETHST ($29,498)
   - HF: 1.03 ✅ Saved!

**The buffer saved you from liquidation**

---

## Hedging Strategy 3: Delta-Neutral Position

**Advanced: Maintain DeFi position with zero price exposure**

### Concept

- Long ETHST (via collateral)
- Short ETHST (via perps or options)
- Net: Zero price exposure
- Earn: Lending/LP fees minus short costs

**Implementation on STRATO:**

1. **Supply 10 ETHST collateral**
2. **Borrow USDST against it**
3. **Short ETHST on another platform** (e.g., dYdX, GMX)
4. **Net exposure:** Zero ETHST price risk

**Pros:**

- Completely hedged
- Earn DeFi yields without price risk
- Perfect for ranging markets

**Cons:**

- Complex to manage
- Shorting costs (funding rates)
- Need account on derivatives platform
- May not be net profitable

**Not commonly recommended for most users**

---

## Hedging Strategy 4: Gradual De-Risking

**As market becomes uncertain, gradually reduce risk**

### Phase 1: Normal Market

```
Collateral: 10 ETHST
Debt: 15,000 USDST
HF: 1.2
Risk: Moderate
```

### Phase 2: Volatility Increases

**Actions:**

1. Repay 3,000 USDST
2. Improve HF to 1.4
3. Cost: Interest stops on repaid amount

```
Collateral: 10 ETHST
Debt: 12,000 USDST
HF: 1.4
Risk: Lower
```

### Phase 3: Market Crashing

**Actions:**

1. Repay another 5,000 USDST
2. HF increases to 2.57
3. Very safe from liquidation

```
Collateral: 10 ETHST
Debt: 7,000 USDST
HF: 2.57
Risk: Very low
```

### Phase 4: Recovery

**Actions:**

1. Borrow again as market stabilizes
2. Return to normal risk level
3. Missed some downside, kept position open

**This is the simplest and most reliable hedge strategy**

---


## Cost-Benefit Analysis

### Strategy 1: Mixed Collateral

| Metric | Value |
|--------|-------|
| Setup cost | $18 (swap fees) |
| Ongoing cost | Increased debt interest |
| Benefit | Reduced volatility |
| Best for | Conservative users |

### Strategy 2: Safety Buffer

| Metric | Value |
|--------|-------|
| Setup cost | $18 (swap fees) |
| Ongoing cost | Opportunity cost on buffer |
| Benefit | Emergency protection |
| Best for | Moderate risk-takers |

### Strategy 3: Delta-Neutral

| Metric | Value |
|--------|-------|
| Setup cost | Varies (exchange fees) |
| Ongoing cost | Shorting funding rates |
| Benefit | Zero price risk |
| Best for | Advanced traders |

### Strategy 4: Gradual De-Risk

| Metric | Value |
|--------|-------|
| Setup cost | None |
| Ongoing cost | Reduced interest (benefit!) |
| Benefit | Simple, effective |
| Best for | Everyone |

**Recommendation: Strategy 4 (Gradual De-Risk) for most users**

---

## Real Example: 2022 Bear Market

**User: Bob**

**May 2022:**

- Collateral: 10 ETHST @ $3,000 = $30k
- Debt: 15,000 USDST
- HF: 1.2

**Bob's action:** Implemented Safety Buffer
- Minted 5,000 USDST via CDP
- Swapped to USDCST - Held as emergency fund

**November 2022:**

- ETHST crashed to $1,200 (-60%)
- Collateral now: $12,000
- Debt: 20,000 (15k + 5k minted)
- HF: Would be 0.36 → LIQUIDATED

**Bob's response:**

- Used 5,000 USDCST buffer
- Bought 4.16 ETHST @ $1,200
- Added to collateral
- New collateral: 14.16 ETHST @ $1,200 = $17k
- New HF: 0.51 (still liquidated!)

**Bob needed more buffer!**

**Lesson:** In extreme crashes (>50%), even buffers may not be enough

---

## Recommended Buffer Sizes

**By leverage level:**

| Leverage | Debt/Collateral | Buffer Size | Can Survive Drop |
|----------|-----------------|-------------|------------------|
| Low | 30-40% | 10% | 40-50% crash |
| Medium | 50-60% | 20% | 30-35% crash |
| High | 60-70% | 30% | 20-25% crash |

**Formula:**
```
Buffer = (Target drop% × Collateral value) - Available borrowing room
```

**Example:**

- Want to survive 40% drop
- Collateral: $30k
- Current debt: $15k (50%)
- Max debt: $22.5k (75%)
- Available room: $7.5k

**If 40% drop:**

- New collateral: $18k
- Debt stays: $15k
- HF would be: 0.72 (liquidated)

**Buffer needed:**

- $15k / 0.6 = $25k collateral needed
- Have $18k after drop
- Need: $7k buffer

**Buffer needed: ~$7k (~23% of original collateral)**

---

## Automation Ideas (Advanced)

**Set up automatic hedging:**

1. **Price-triggered repayments:**

   - If ETHST < $2,700: Auto-repay 2k USDST
   - If ETHST < $2,400: Auto-repay another 3k
   - Requires keeper bots or limit orders

2. **Dynamic collateral ratios:**

   - Monitor volatility index
   - Auto-rebalance to stable collateral when volatility spikes
   - Requires custom scripts

3. **Health factor triggers:**

   - If HF < 1.5: Auto-add collateral from buffer
   - Keeper bot watches on-chain
   - Executes transactions when needed

**Most users:** Manual monitoring is sufficient

---

## Red Flags: When to Hedge

### Market Signals

- [ ] VIX > 30 (high volatility)
- [ ] ETHST drops > 10% in 24 hours
- [ ] Liquidations spiking across DeFi
- [ ] Macro uncertainty (Fed meetings, etc.)
- [ ] Funding rates extremely negative/positive

### Position Signals

- [ ] Your HF drops below 1.5
- [ ] Borrow rates suddenly spike
- [ ] Can't sleep worrying about position
- [ ] Position size is uncomfortable
- [ ] Haven't checked in 3+ days

**If 3+ boxes checked: Consider hedging or de-risking**

---

## Summary: Hedge Strategy Selection

| Your Situation | Recommended Strategy |
|----------------|---------------------|
| Beginner, worried | Gradual De-Risk (#4) |
| Medium position | Safety Buffer (#2) |
| Large position | Mixed Collateral (#1) |
| Advanced trader | Delta-Neutral (#3) |
| Market crashing | De-Risk immediately |
| Bull market | Light hedge or none |

**Golden rule:** Hedge when you can't afford not to

---

## Next Steps

- **[Portfolio Rebalancing](portfolio-rebalancing.md)** - Diversify risk
- **[Exit Strategy](withdrawals.md)** - When hedges fail
- **[Safety Guide](../safety.md)** - Comprehensive risk overview

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)

