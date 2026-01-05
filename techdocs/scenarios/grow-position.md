# Grow Your Position (Conservative Looping)

Safely increase your asset holdings through strategic borrowing and reinvestment.

!!! warning "Variable Parameters"
    All interest rates, prices, health factors, and gas costs in this guide are **examples only**.
    Actual values vary based on market conditions and protocol parameters.
    
    **Always check current rates in the app before proceeding.**

---

## The Strategy

**The smart way to increase your ETH holdings:**

Instead of buying more ETH with new capital, use your existing ETH to borrow stablecoins, buy more ETH, and repeat. This lets you grow your position while maintaining a healthy safety margin.

**Why this works:**

1. ✅ Increase ETH exposure without new capital
2. ✅ Keep health factor safe throughout
3. ✅ Amplify gains if ETH appreciates
4. ✅ Maintain control of your position
5. ✅ Exit anytime by repaying debt

**The loop:**

```
Supply ETH → Borrow USDST → Buy more ETH → Supply new ETH → Repeat
```

---

## Complete Example: Growing 5 ETH to 7.5 ETH

**Your starting position:**

- You have: 5 ETH ($15,000 @ $3,000/ETH)
- You want: More ETH exposure
- Your approach: Conservative looping (2 rounds)

**The outcome:**

- Final position: 7.5 ETH
- Debt: $7,500 USDST
- Health Factor: 2.4 (very safe)
- Effective leverage: 1.5x
- Time needed: 15 minutes

**If ETH goes up 20% to $3,600:**

- Without looping: 5 ETH = $18,000 (gain: $3,000)
- With looping: 7.5 ETH = $27,000 (gain: $12,000)
- **You earned 4x more!**

---

## Step-by-Step Implementation

### Round 1: Initial Position

#### Step 1: Supply Your ETH (2 min)

1. Go to **Borrow** (sidebar)
2. In Collateral Management table, find **ETH** → Click **"Supply"**
3. Enter amount: **5.0**
4. Click **"Supply"** (~$0.10 gas, approval automatic)

**Result:**
```
✅ Collateral: 5 ETH ($15,000)
✅ Can borrow: Up to $11,250 (75% LTV)
✅ Health Factor: N/A (no debt yet)
```

---

#### Step 2: Borrow Conservatively (2 min)

**Conservative approach:** Borrow 50% of max (not 75%)

1. Go to **Borrow** section
2. Enter amount: **5,000** USDST (not the max!)
3. Review:
   - Health Factor: **2.4** (very safe)
   - Interest: ~5% = $250/year
4. Click **"Borrow"**
5. Confirm (~$0.10 gas)

**Why only 50%?**

- Leaves room for price drops
- Keeps health factor high
- Allows for more loops safely

**Result:**
```
✅ Borrowed: 5,000 USDST
✅ Health Factor: 2.4 (very safe)
✅ Collateral: 5 ETH ($15,000)
```

---

#### Step 3: Buy More ETH (2 min)

1. Go to **Swap Assets**
2. From: **USDST** → Amount: **5,000**
3. To: **ETH**
4. Review quote: ~1.65 ETH (after 0.3% swap fee)
5. Click **"Swap"**
6. Confirm (~$0.10 gas)

**Result:**
```
✅ Received: ~1.65 ETH
✅ Total ETH in wallet: 1.65 ETH
✅ Ready for next loop
```

---

### Alternative: Diversify Into Other Assets

**Instead of buying more ETH, you can diversify your collateral:**

#### Option A: Add Bitcoin Exposure

**Why BTC?**
- Different price movements from ETH
- Store of value characteristics
- Portfolio diversification

**How to do it:**

1. Go to **Swap Assets**
2. From: **USDST** (5,000) → To: **WBTCST**
3. Review quote: ~0.075 BTC (at ~$65,000/BTC)
4. Click **"Swap"**
5. Go to **Borrow** page
6. Supply WBTCST as collateral
7. Continue looping

**Result:**
```
✅ Collateral: 5 ETH + 0.075 BTC
✅ Diversified portfolio
✅ Different price exposures
```

---

#### Option B: Add Gold Exposure

**Why Gold?**
- Safe haven asset
- Hedge against volatility
- Less correlated with crypto

**How to do it:**

1. Go to **Swap Assets**
2. From: **USDST** (5,000) → To: **GOLDST**
3. Review quote: ~1.9 GOLD (at ~$2,600/oz)
4. Click **"Swap"**
5. Go to **Borrow** page
6. Supply GOLDST as collateral
7. Continue looping

**Result:**
```
✅ Collateral: 5 ETH + 1.9 GOLD
✅ Crypto + precious metal
✅ Risk diversification
```

---

#### Option C: Add Silver Exposure

**Why Silver?**
- Industrial metal demand
- Lower cost entry
- Different market dynamics

**How to do it:**

1. Go to **Swap Assets**
2. From: **USDST** (5,000) → To: **SILVST**
3. Review quote: ~160 SILVER (at ~$31/oz)
4. Click **"Swap"**
5. Go to **Borrow** page
6. Supply SILVST as collateral
7. Continue looping

---

#### Benefits of Diversification

**Risk Management:**
- ✅ Not dependent on single asset price
- ✅ Different correlation patterns
- ✅ Hedged portfolio approach
- ✅ Reduces concentration risk

**Strategy Flexibility:**
- ✅ Same looping process works
- ✅ Mix assets as desired
- ✅ Rebalance over time
- ✅ Adapt to market conditions

**Example Multi-Asset Position:**

```
Starting: 5 ETH

Round 1:
- Supply 5 ETH → Borrow $5,000
- Buy 0.075 BTC → Supply BTC

Round 2:
- Borrow $2,500
- Buy 1.9 GOLD → Supply GOLD

Round 3:
- Borrow $1,500
- Buy 160 SILVER → Supply SILVER

Final Position:
- Collateral: 5 ETH + 0.075 BTC + 1.9 GOLD + 160 SILVER
- Total value: ~$24,000
- Total debt: $9,000
- Health Factor: 2.13 (safe)
- Diversified across 4 assets ✅
```

**When to Diversify:**

- ✅ Want to reduce single-asset risk
- ✅ Bullish on multiple assets
- ✅ Prefer balanced portfolio
- ✅ Long-term holding strategy
- ✅ Risk-averse approach

**When to Stay Single-Asset:**

- ✅ Very bullish on one specific asset
- ✅ Want simplicity
- ✅ Easier position management
- ✅ Clearer exit strategy
- ✅ Strong conviction trade

---

### Round 2: First Loop

#### Step 4: Supply New ETH (2 min)

1. Go back to **Borrow** page
2. In Collateral Management table, find **ETH** → Click **"Supply"**
3. Enter amount: **1.65**
4. Click **"Supply"**

**Result:**
```
✅ Total collateral: 6.65 ETH ($19,950)
✅ Current debt: 5,000 USDST
✅ New health factor: 3.19 (even safer!)
✅ Can borrow more: Up to $9,962
```

**Notice:** Your health factor IMPROVED because you added collateral without adding debt!

---

#### Step 5: Borrow Again (2 min)

**Again, borrow conservatively:**

1. Go to **Borrow** section
2. Enter amount: **2,500** USDST (keeping HF safe)
3. Review:
   - New Health Factor: **2.13** (still safe)
   - Total debt: $7,500
4. Click **"Borrow"**

**Result:**
```
✅ Total borrowed: 7,500 USDST
✅ Health Factor: 2.13 (safe)
✅ Collateral: 6.65 ETH ($19,950)
```

---

#### Step 6: Buy More ETH (2 min)

1. Go to **Swap Assets**
2. From: **USDST** → Amount: **2,500**
3. To: **ETH**
4. Receive: ~0.83 ETH
5. Click **"Swap"**

**Result:**
```
✅ Received: ~0.83 ETH
✅ Total ETH in wallet: 0.83 ETH
```

---

### Round 3: Second Loop (Optional)

#### Step 7: Supply Again (2 min)

1. Supply the 0.83 ETH
2. New total collateral: 7.48 ETH ($22,440)
3. New health factor: 2.39 (very safe)

**At this point, you can:**

**Option A: Stop here (recommended)**
- Total position: 7.48 ETH
- Total debt: $7,500
- Health Factor: 2.39
- Good balance of growth and safety

**Option B: Do one more loop**
- Borrow another $1,500-2,000
- Buy more ETH
- Final position: ~8-8.5 ETH
- Health Factor: still above 2.0

---

## Your Final Position

**Conservative approach (2 loops):**

```
Starting: 5 ETH, $0 debt
Final:    7.5 ETH, $7,500 debt
Growth:   +50% more ETH
HF:       2.4 (very safe)
```

**What you've achieved:**

- ✅ 50% more ETH exposure
- ✅ Maintained safe health factor
- ✅ Can withstand 30%+ ETH price drop
- ✅ Amplified gains if ETH goes up
- ✅ Still have room to borrow more if needed

---

## Understanding the Math

### Leverage Calculation

**Your effective leverage:**

```
Total ETH value: 7.5 ETH × $3,000 = $22,500
Your equity: $22,500 - $7,500 debt = $15,000
Leverage: $22,500 / $15,000 = 1.5x
```

**What this means:**

- If ETH goes up 10%, your equity goes up 15%
- If ETH goes down 10%, your equity goes down 15%
- Moderate amplification, not extreme

---

### Health Factor at Each Stage

**Starting:**
- Collateral: $15,000
- Debt: $5,000
- HF = (15,000 × 0.80) / 5,000 = 2.4

**After Loop 1:**
- Collateral: $19,950
- Debt: $7,500
- HF = (19,950 × 0.80) / 7,500 = 2.13

**After Loop 2:**
- Collateral: $22,440
- Debt: $7,500
- HF = (22,440 × 0.80) / 7,500 = 2.39

**Notice:** HF stays above 2.0 throughout!

---

## Risk Management

### When to Stop Looping

**Stop when:**

- ✅ Health factor drops below 2.0
- ✅ You've reached your target ETH amount
- ✅ You're uncomfortable with debt level
- ✅ Market conditions change

**Don't:**

- ❌ Loop until HF is 1.5 or lower
- ❌ Borrow maximum each time
- ❌ Ignore health factor warnings
- ❌ Loop more than 3-4 times

---

### Price Drop Scenarios

**Your position:** 7.5 ETH, $7,500 debt, HF 2.39

**If ETH drops 15% to $2,550:**
- Collateral value: $19,125
- HF = (19,125 × 0.80) / 7,500 = 2.04
- **Status:** Still safe ✅

**If ETH drops 30% to $2,100:**
- Collateral value: $15,750
- HF = (15,750 × 0.80) / 7,500 = 1.68
- **Status:** Getting risky ⚠️
- **Action:** Add collateral or repay debt

**If ETH drops 50% to $1,500:**
- Collateral value: $11,250
- HF = (11,250 × 0.80) / 7,500 = 1.20
- **Status:** Dangerous ⚠️⚠️
- **Action:** Urgent - add collateral NOW

**Liquidation at:**
- ETH < $1,250 (58% drop from $3,000)
- Very unlikely in short/medium term

---

### Daily Monitoring

**Check these daily:**

1. **Health Factor**
   - Target: Keep above 2.0
   - Warning: Below 1.8
   - Danger: Below 1.5

2. **ETH Price**
   - Set alert at $2,550 (15% drop)
   - Set alert at $2,100 (30% drop)

3. **Debt Growth**
   - Interest accrues daily
   - ~$1.03/day at 5% APR on $7,500

---

## When to Exit

### Taking Profits

**If ETH goes up 30% to $3,900:**

Your position value:
- 7.5 ETH × $3,900 = $29,250
- Minus debt: $7,500
- Your equity: $21,750
- **Profit: $6,750 (45% gain on $15k initial)**

**To exit:**

1. Sell enough ETH to repay debt
   - Need: $7,500 / $3,900 = 1.92 ETH
2. Sell 2 ETH for $7,800 USDST
3. Repay $7,500 debt
4. Withdraw remaining 5.5 ETH
5. **Final:** 5.5 ETH (up from 5) + $300 USDST

---

### Emergency Exit

**If ETH is dropping fast:**

1. **Sell ETH for USDST**
   - Sell 2 ETH for ~$6,000 (if ETH at $3,000)
2. **Repay partial debt**
   - Repay $6,000 of $7,500
   - Remaining debt: $1,500
3. **Improve health factor**
   - New HF jumps to ~3.0+
4. **Wait for market to stabilize**

---

## Comparison: With vs Without Looping

### Scenario: ETH goes from $3,000 to $3,600 (+20%)

**Without looping:**
- Start: 5 ETH = $15,000
- End: 5 ETH = $18,000
- Profit: $3,000 (20%)

**With conservative looping (2 rounds):**
- Start: 5 ETH = $15,000
- End: 7.5 ETH = $27,000
- Minus debt: $7,500
- Equity: $19,500
- Profit: $4,500 (30%)
- **50% more profit!**

### Scenario: ETH goes from $3,000 to $2,400 (-20%)

**Without looping:**
- Start: 5 ETH = $15,000
- End: 5 ETH = $12,000
- Loss: $3,000 (-20%)

**With conservative looping:**
- Start: 5 ETH = $15,000
- End: 7.5 ETH = $18,000
- Minus debt: $7,500
- Equity: $10,500
- Loss: $4,500 (-30%)
- **50% more loss**

**Key insight:** Leverage amplifies BOTH gains and losses proportionally.

---

## Advanced: More Aggressive Looping

### 3-4 Loops (Higher Risk)

**If you want more exposure:**

- Loop 3-4 times instead of 2
- Final position: ~9-10 ETH
- Debt: ~$10,000-12,000
- Health Factor: ~1.8-2.0
- Leverage: ~2x

**Trade-offs:**

- ✅ More upside if ETH goes up
- ❌ Less safety buffer
- ❌ Liquidation risk higher
- ❌ More interest costs

**Only do this if:**

- You can monitor position constantly
- You have funds to add collateral quickly
- You're comfortable with higher risk
- Market conditions are favorable

---

## Tips for Success

### DO ✅

- Start with 2-3 loops maximum
- Keep health factor above 2.0
- Borrow 50-60% of max each time
- Monitor position daily
- Set price alerts
- Have emergency funds ready

### DON'T ❌

- Loop until HF is 1.5 or lower
- Borrow maximum each round
- Ignore health factor warnings
- Loop more than 4 times (beginners)
- Forget about accruing interest
- Panic sell at small drops

---

## Cost-Benefit Analysis

### Costs

**Interest on $7,500 debt:**
- Rate: ~5% APR
- Cost: $375/year
- Daily: ~$1.03

**Gas fees:**
- 6 transactions total
- ~$0.60 total
- Negligible

**Swap fees:**
- 0.3% per swap
- ~$22.50 total on $7,500 swapped
- One-time cost

**Total first-year cost:** ~$398

### Benefits

**If ETH goes up 20%:**
- Extra profit: $1,500
- Net after costs: $1,102
- **Worth it!**

**If ETH stays flat:**
- No price gain
- Pay $398 in costs
- **Not worth it**

**Break-even:** ETH needs to go up ~5% to cover costs

---

## Frequently Asked Questions

### Can I loop with other assets?

Yes! This works with any collateral:
- BTC (WBTCST)
- Gold (GOLDST)
- Silver (SILVST)

Same process, same safety principles.

### Can I loop into different assets each time?

Absolutely! Each loop can buy a different asset:

**Example multi-asset loop:**

1. **Round 1:** Supply 5 ETH → Borrow $5k → Buy 0.075 BTC
2. **Round 2:** Supply BTC → Borrow $2.5k → Buy 1.9 GOLD
3. **Round 3:** Supply GOLD → Borrow $1.5k → Buy 160 SILVER

**Result:**
- Diversified collateral: ETH + BTC + GOLD + SILVER
- Total debt: $9,000
- Health Factor: 2.1+ (safe)

**Benefits:**
- ✅ Spread risk across multiple assets
- ✅ Capture different price movements
- ✅ Portfolio diversification
- ✅ Same health factor management
- ✅ Flexible strategy

**Considerations:**
- More complex to track
- Different LTV ratios per asset
- Multiple price correlations
- Rebalancing may be needed

### How many times can I loop?

**Safely:** 2-3 times (HF > 2.0)
**Aggressively:** 4-5 times (HF > 1.5)
**Maximum:** Until HF approaches 1.0 (very risky)

### What if I want to unwind one loop?

Easy! Just:
1. Sell some ETH for USDST
2. Repay part of your debt
3. Your HF improves
4. Withdraw some collateral if desired

### Can I loop with CDP instead of Lending?

Yes! Same concept:
- Use CDPEngine instead of LendingPool
- Mint USDST instead of borrow
- Lower fees (2-3% vs 5%)
- Different risk metrics (CR vs HF)

---

## Next Steps

**Ready to start?**

1. **Practice with small amounts first**
   - Try with 0.5-1 ETH
   - Do 1-2 loops
   - Get comfortable with the process

2. **Scale up gradually**
   - Once confident, use more capital
   - Add more loops carefully
   - Always monitor health factor

3. **Learn more:**
   - [Borrow Guide](../guides/borrow.md) - Detailed borrowing mechanics
   - [Swap Guide](../guides/swap.md) - How to swap efficiently
   - [Exit Strategy](exit-strategy.md) - How to unwind safely

---

## Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)

