# Maximize Yield Strategy

Combine multiple STRATO features to maximize returns on your crypto.

!!! warning "Variable Parameters"
    All interest rates, APRs, fees, and gas costs in this guide are **examples only**.
    Actual values vary based on:
    
    - Pool utilization and trading volume
    - Market conditions and volatility
    - Protocol governance decisions
    - Network congestion (for gas)
    
    **Always check current rates in the app before proceeding.**

---

## The Strategy

Use borrowed/minted USDST to provide liquidity and earn multiple income streams.

**Income sources:**

1. ✅ Trading fees from liquidity (example: 8-12% APR)
2. ✅ CATA rewards for all activities (varies)
3. ✅ Keep your original collateral (potential appreciation)

**Net result (example):** Earn ~10-15% APR while keeping your ETH

---

## Complete Example: 10 ETH Position

**Your situation:**

- You have: 10 ETH ($30,000)
- You want: Maximum yield

**The play:**

1. Supply 10 ETH as collateral
2. Borrow 10,000 USDST against it
3. Provide sUSDSST-USDST liquidity
4. Earn fees + CATA rewards
5. Net yield: ~10% annually

**Expected returns:**

- Interest cost: -5% on $10k = -$500/year
- Liquidity fees: +10% on $10k = +$1,000/year
- CATA rewards: +$500/year (estimated)
- **Net: +$1,000/year (~10% on $10k position)**
- **Plus:** Keep 10 ETH exposure

---

## Step-by-Step Implementation

### Step 1: Supply Collateral (2 min)

1. Go to **Borrow** (sidebar)
2. In Collateral Management table, find **ETH** → Click **"Supply"**
3. Enter amount: **10.0**
4. Click **"Supply"** (approval happens automatically)
5. Gas: ~$0.10

**Result:**
```
Collateral: 10 ETH ($30,000)
Can borrow: Up to $22,500 (75% LTV)
```

---

### Step 2: Borrow USDST (2 min)

**Conservative approach:**

1. Go to **Borrow** (sidebar) → **Borrow** section
2. Amount: **10,000** USDST (not max!)
3. Review:

   - Health Factor: **2.4** (very safe)
   - Interest: ~5% = $500/year (example rate)
4. Click **"Borrow"**
5. Confirm (~$0.10 gas)

**Why not max?**
- Max is $22,500
- But borrowing $10k keeps HF at 2.4
- Large safety buffer for price drops

**Result:**
```
Borrowed: 10,000 USDST
Health Factor: 2.4 (very safe)
Interest cost: ~$500/year
```

---

### Step 3: Get Matching Assets (5 min)

**You need:** USDST + sUSDSST pair for liquidity

**You have:** 10,000 USDST  
**You need:** 5,000 sUSDSST

**What is sUSDSST?**
- Based on Sky protocol's sUSDS (formerly MakerDAO)
- Yield-bearing stablecoin that earns Sky's savings rate
- STRATO-wrapped version for use in the ecosystem
- Maintains ~1:1 peg with USDST

**How to get sUSDSST:**

**Option A: Swap half your USDST**
1. Go to **Swap Assets**
2. From: **USDST** → Amount: **5,000**
3. To: **sUSDSST**
4. Execute swap
5. Gas: ~$0.10

**Option B: Bridge from Ethereum (if you have sUSDS)**
1. Go to **Deposits** → **Bridge In** tab
2. Bridge sUSDS from Ethereum
3. Automatically wrapped to sUSDSST

**For this example, use Option A (swap):**

**Result:**
```
USDST: 5,000
sUSDSST: ~5,000 (1:1 ratio typically)
Ready for liquidity
```

---

### Step 4: Provide Liquidity (3 min)

1. Go to **Advanced** (sidebar) → **Swap Pools** tab
2. Select **sUSDSST-USDST pool**
3. Check stats:

   - APR: Example 10% (fees - varies by volume)
   - Volume: Check current 24h volume
   - CATA rewards: Active
4. Enter amounts:

   - USDST: **5,000**
   - sUSDSST: **~5,000** (ratio typically 1:1)
5. Click **"Add Liquidity"** (approvals happen automatically)
6. Gas: ~$0.10

**Result:**
```
Liquidity provided: $10,000
Pool share: varies
Earning: ~$3/day in fees (example)
Plus: CATA rewards
Plus: sUSDSST earns Sky savings rate while in pool
```

---

## Your Complete Position

**Assets:**

- Original: 10 ETH (as collateral)
- Borrowed: 10,000 USDST (5k in LP as USDST, ~5k in LP as sUSDSST)
- Liquidity: $10k sUSDSST-USDST LP tokens

**Income streams:**

1. **Trading fees:** ~$3/day = $1,095/year
2. **CATA rewards:** ~$1-2/day = $500/year
3. **Total income:** ~$1,600/year

**Costs:**

- Interest on 10k USDST: ~$500/year

**Net profit:** ~$1,100/year on $30k position = **3.7% yield**

**Plus:**

- Keep 10 ETH exposure (if ETH appreciates 20%, you earn $6k more)
- Compounding if you reinvest rewards

---

## Expected Returns Breakdown

### Income

| Source | Amount | Calculation |
|--------|--------|-------------|
| LP fees (10% APR) | $1,000/year | $10k × 10% |
| CATA rewards | $500/year | Estimated |
| **Total Income** | **$1,500/year** | |

### Costs

| Cost | Amount | Calculation |
|------|--------|-------------|
| Borrow interest (5%) | $500/year | $10k × 5% |
| Gas fees | $50/year | Approx |
| **Total Cost** | **$550/year** | |

### Net Profit

```
Net = Income - Cost
    = $1,500 - $550
    = $950/year

Return on borrowed capital: 9.5% APR
Return on total position: 3.2% APR (plus ETH exposure)
```

---

## Risk Management

### Monitor Health Factor Daily

**Your HF starts at 2.4:**

- Very safe with large buffer
- If ETH drops 15% to $2,550: HF drops to ~2.04 (still safe)
- If ETH drops 30% to $2,100: HF drops to ~1.68 (getting lower)
- If ETH drops 50% to $1,500: HF drops to ~1.20 (risky)

**Liquidation occurs when HF < 1.0:**

- With $10k debt and 80% liquidation threshold
- Liquidation at ETH < $1,250 (58% drop from $3,000)

**Actions:**

- Set price alert at $2,100 ETH (30% drop)
- If triggered, add collateral or repay debt
- Keep HF above 1.5 at minimum for safety

### Impermanent Loss Consideration

**sUSDSST-USDST pair:**

- Both are USD-pegged stablecoins
- sUSDSST is Sky protocol's yield-bearing stablecoin (wrapped on STRATO)
- Minimal price divergence (both maintain $1 peg)
- IL risk is very low (~0.1%)
- Perfect for this leveraged strategy

**Why this pair is ideal:**

- Nearly 1:1 peg maintained between USDST and sUSDSST
- Small variations only from sUSDSST's accrued Sky savings rate
- Much safer than volatile pairs
- You earn Sky's yield on the sUSDSST portion while providing liquidity

**Bonus benefit:**

- Your sUSDSST in the pool continues earning Sky's savings rate
- This provides additional yield on top of trading fees
- Triple yield: trading fees + CATA rewards + Sky savings rate

**If using volatile pairs (e.g., USDST-ETHST):**

- Higher trading fees, but also higher IL risk
- Not recommended for leveraged positions
- Price divergence can erode profits

### Compound Your Rewards

**Weekly routine:**

1. Claim CATA rewards
2. Swap CATA → USDST
3. Convert half to sUSDSST via swap
4. Add both to liquidity pool
5. Increases your earning power

**Effect over 1 year:**

- Simple: $1,500 earned
- Compounded weekly: ~$1,550 earned
- Extra $50 from compounding

---

## Advanced: Scale Up

### 20 ETH Position

**Double everything:**

- Collateral: 20 ETH ($60k)
- Borrow: 20,000 USDST
- Liquidity: $20k
- Health Factor: 2.4 (same safety)

**Net earnings:**

- ~$1,900/year (scales linearly)
- ~3.2% on $60k position
- Plus 20 ETH exposure

### Using CDP Instead

**Lower interest costs:**

- CDP stability fee: ~2-3%
- Lending interest: ~5%
- **Savings: $200-300/year**

**Trade-off:**

- Lower fees
- But need to manage CR instead of HF

---

## Exit Strategy

### When to Exit

**Exit if:**

- ETH price dropping significantly
- Pool fees decrease below interest cost
- Better opportunities elsewhere
- Need capital for other uses

### How to Exit

1. **Remove liquidity:**

   - Go to Advanced → Swap Pools → Your Liquidity
   - Find sUSDSST-USDST position
   - Click "Remove" to exit LP
   - Receive USDST + sUSDSST back

2. **Repay debt:**

   - Swap sUSDSST → USDST if needed
   - Repay full 10,000 USDST debt
   - Plus accrued interest

3. **Withdraw collateral:**

   - Withdraw your 10 ETH
   - Return to wallet

4. **Claim final rewards:**

   - Claim remaining CATA
   - Swap or hold

**See:** [Exit Strategy Guide](exit-strategy.md)

---

## Alternative Strategies

### Strategy 2: Mint + Provide Liquidity

**Use CDP instead of lending:**

- Lower fees (2-3% vs 5%)
- Better for long-term

### Strategy 3: Borrow → Stake

**Provide liquidity in high-APR pools:**

- Some pools offer 20-30% APR
- Higher risk (volatile pairs)
- Can earn more but watch IL

### Strategy 4: Recursive Borrowing

**Advanced:**

- Borrow USDST
- Swap to more ETH
- Supply as collateral
- Borrow more USDST
- Repeat 2-3 times
- **High risk - not recommended for beginners**

---

## Real Example: 30-Day Results

**Starting position:**

- 10 ETH supplied
- 10k USDST borrowed
- $10k in sUSDSST-USDST LP

**After 30 days:**

| Metric | Amount |
|--------|--------|
| ETH collateral | 10 ETH (same) |
| Debt owed | 10,042 USDST (+$42 interest) |
| LP value | $10,025 (fees earned) |
| CATA earned | 50 tokens ($100 value) |
| **Net profit** | $83 for the month |

**Annualized:** $83 × 12 = $996/year (~3.3% yield)

**Plus:** If ETH appreciated 10% → +$3,000 gain

---

## Tips for Success

### DO ✅

- Start with conservative borrowing (HF > 2.0)
- Use stable-stable pairs (sUSDSST-USDST)
- Monitor health factor daily
- Compound rewards weekly
- Keep safety buffer in USDST

### DON'T ❌

- Max out borrowing capacity
- Use volatile pairs when leveraged
- Ignore health factor warnings
- Forget about accruing interest
- Over-leverage your position

---

## Next Steps

- **[Safety Guide](../safety.md)** - Protect your leveraged position
- **[Liquidity Guide](../guides/liquidity.md)** - Deep dive on LP

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)

