# Borrow USDST

Access USD liquidity without selling your crypto assets.

!!! info "Alternative: Mint via CDP"
    You can also **[mint USDST via CDP](mint-cdp.md)** which typically has lower fees but requires more active management.

!!! note "Variable Parameters"
    Interest rates, gas costs, and asset parameters shown are typical examples. Actual values may vary based on network conditions, asset type, and governance settings. Always check current rates in the app before transacting.

---

## Complete Example: Borrow $1,000 USDST

**Your situation:**

- You have: 1 ETHST in your wallet
- ETHST price: $3,000
- You need: $1,000 USDST for expenses

**What you'll do:**

1. Supply 1 ETHST as collateral
2. Borrow 1,000 USDST
3. Use your USDST
4. Repay the loan (anytime)
5. Withdraw your collateral

**Time needed:** 5 minutes  
**Total gas cost:** ~$0.30 (3 transactions)  
**Interest cost:** ~$4 per month (5% annual rate)

---

## Step 1: Supply Collateral

**What you have:**

- 1 ETHST worth $3,000

**In the app:**

1. **Go to Borrow page** (in sidebar)
2. **In the Collateral Management table**, find **ETHST**
3. Click the **"Supply"** button for ETHST 4. **In the modal:**
   - Enter amount: **1.0** (or click "Max")
   - Review the health impact preview
5. **Click "Supply"**
   - Confirm in wallet (~$0.10 gas)
   - Approval + supply happen automatically in one transaction
   - Wait 1-2 seconds

**Result:**
```
✅ Collateral supplied: 1 ETHST ($3,000)
✅ Can borrow up to: $2,250 USDST (75% of collateral)
✅ Health Factor: N/A (no debt yet)
```

**Your wallet:**

- Before: 1 ETHST
- After: 0 ETHST (moved to collateral vault)

---

## Step 2: Borrow USDST

**What you want:** $1,000 USDST

**In the app:**

1. **Go to Borrow section** → Click **"Borrow"**
2. **Enter amount:** Type **1000** USDST
3. **Review the preview:**

   - Borrowing: 1,000 USDST
   - New Health Factor: **1.8** (Safe ✓)
   - Interest Rate: ~5% annually
   - Max you could borrow: $2,250
4. **Click "Borrow"**
   - Confirm in wallet (~$0.10 gas)
   - Wait 1-2 seconds

**Result:**
```
✅ Borrowed: 1,000 USDST
✅ Health Factor: 1.8 (Safe)
✅ Your wallet: +1,000 USDST
```

**Your position now:**

- Collateral: 1 ETHST ($3,000)
- Debt: 1,000 USDST
- Health Factor: 1.8 (very safe)
- Still available to borrow: $1,250 more (but don't!)

**What is Health Factor?**
- **Above 2.0:** Very safe ✅
- **1.5 - 2.0:** Safe with buffer
- **1.0 - 1.5:** Moderate risk ⚠️
- **Below 1.0:** Liquidation danger ❌

Your 1.8 health factor means you have a good safety buffer.

---

## Step 3: Use Your USDST

You now have 1,000 USDST to use for:

- ✅ Transaction fees on STRATO
- ✅ Swap for other tokens
- ✅ Provide liquidity
- ✅ Bridge to other chains
- ✅ Any other purpose

**Your debt grows slowly:**

- Interest: ~5% per year = 0.014% per day
- After 1 day: Owe $1,000.14
- After 30 days: Owe ~$1,004
- After 1 year: Owe ~$1,050

---

## Step 4: Repay (Anytime)

**When you're ready** (no rush, but interest accumulates):

1. **Get USDST to repay**
   - You might have it from what you borrowed
   - Or swap other tokens for USDST
   - Or mint more via CDP

2. **Go to Borrow page** (in sidebar) → **"Repay"**
3. **Enter amount:**

   - Type specific amount (e.g., 1004 to repay all)
   - Or click **"Repay Max"** to close loan completely
4. **Click "Repay"**
   - Confirm in wallet (~$0.10 gas)
   - Wait 1-2 seconds

**Result after full repayment:**
```
✅ Debt repaid: 1,004 USDST (1,000 principal + 4 interest)
✅ Health Factor: N/A (no debt)
✅ Gas cost: ~$0.10
```

**Your position:**

- Collateral: 1 ETHST (still in vault)
- Debt: 0 USDST
- Health Factor: No debt
- You can now withdraw collateral

---

## Step 5: Withdraw Collateral

**After repaying fully:**

1. **Go to Borrow page** (in sidebar)
2. **In the Collateral Management table**, find your asset
3. Click the **"Withdraw"** button for that asset
2. **Select asset:** Choose **ETH**
3. **Enter amount:** Type **1.0** (or click "Max")
4. **Click "Withdraw Collateral"**
   - Confirm in wallet (~$0.10 gas)
   - Wait 1-2 seconds

**Result:**
```
✅ Withdrawn: 1 ETHST to your wallet
✅ Total position closed
```

**Final accounting:**

- You borrowed: 1,000 USDST
- You repaid: 1,004 USDST
- Total cost: $4 interest + $0.30 gas = **$4.30 total**
- You still have: 1 ETHST (same as you started)

---

## What If Prices Change?

### Scenario: ETHST Drops to $2,500

**What happens:**

- Your collateral value: Now $2,500 (was $3,000)
- Your debt: Still 1,000 USDST (unchanged)
- Your health factor: Drops to **1.5** (caution ⚠️)

**What to do:**

- **Option 1: Add more collateral** - Supply 0.2 more ETHST - **Option 2: Repay some debt** - Repay 400 USDST
- **Option 3: Monitor closely** - Still safe, but watch the price

### Scenario: ETHST Drops to $2,000 (Danger!)

**What happens:**

- Your collateral value: Now $2,000
- Your debt: Still 1,000 USDST
- Your health factor: **1.0** (liquidation risk ❌)

**Danger zone:**

- Health factor below 1.0 = **you can be liquidated**
- Liquidators can repay your debt and take your collateral
- You lose 5-10% of collateral value as liquidation bonus

**What to do immediately:**

1. Add more collateral, OR
2. Repay some/all debt
3. Don't let health factor drop below 1.0!

**Best practice:** Keep health factor **above 2.0** for safety buffer.

---

## Managing Your Position

### Check Your Position

**In the app:**

- Go to **Borrow** page (in sidebar)
- You'll see:

  - Collateral amount and value
  - Debt amount (with accrued interest)
  - Health Factor with color indicator
  - Available to borrow or withdraw

**Health Factor colors:**

- 🟢 **Green (> 2.0):** Safe
- 🟡 **Yellow (1.5-2.0):** Caution
- 🟠 **Orange (1.0-1.5):** Warning
- 🔴 **Red (< 1.0):** Danger - liquidation imminent

### Adding More Collateral

If health factor drops:

1. Go to **Supply**
2. Add more collateral
3. Health factor improves immediately

### Partial Repayment

Don't need to repay all at once:

1. Go to **Repay**
2. Enter any amount to repay
3. Reduces debt and improves health factor

---

## Tips & Best Practices

### DO ✅

- **Over-collateralize:** Supply 2-3x what you plan to borrow
- **Monitor daily:** Check health factor when prices move
- **Set alerts:** Use price alerts for your collateral assets
- **Keep buffer:** Maintain health factor above 2.0
- **Start small:** Test with small amounts first
- **Save USDST:** Keep some USDST for gas fees

### DON'T ❌

- **Max out:** Don't borrow your maximum capacity
- **Ignore warnings:** Yellow/orange health factor = take action
- **Forget interest:** Debt grows daily (track it)
- **Use all crypto:** Keep some assets liquid
- **Panic sell:** Add collateral instead during dips
- **Forget gas:** Always have USDST for fees

---

## Common Issues

### "Insufficient collateral"

**Problem:** Trying to borrow more than your collateral allows

**Solution:**

1. Supply more collateral first, OR
2. Reduce the borrow amount

---

### "Would exceed health factor limit"

**Problem:** This borrow would make your health factor too low

**Solution:**

- Reduce borrow amount
- Supply more collateral
- Check your calculation: Can borrow up to 75% of collateral value

---

### "Insufficient USDST balance"

**Problem:** Don't have enough USDST to repay

**Solution:**

1. Swap other tokens for USDST, OR
2. Mint USDST via CDP, OR
3. Repay a smaller amount now, rest later

---

### "Approval needed" or "Insufficient allowance"

**Problem:** Token approval failed in the bundled transaction

**Solution:**

1. Try the supply operation again
2. Ensure you have enough gas for the transaction
3. Wait for confirmation
4. Then retry your action

---

### Health factor dropping

**Problem:** Your collateral value is decreasing

**Solution (act quickly):**

1. **Add collateral:** Supply more assets
2. **Repay debt:** Even partial repayment helps
3. **Monitor closely:** Set price alerts
4. **Don't wait:** Act before it reaches 1.0

---

## Understanding Costs

### Interest Rates

**How interest works:**

- Interest accrues every second
- Typical rate: ~5% annually
- Compounds continuously

**Example costs:**
| Borrowed | Time | Interest Owed |
|----------|------|---------------|
| $1,000 | 1 day | $0.14 |
| $1,000 | 1 week | $1 |
| $1,000 | 30 days | $4 |
| $1,000 | 1 year | $50 |
| $10,000 | 30 days | $40 |

### Gas Fees

| Action | Gas Cost |
|--------|----------|
| Supply collateral | ~$0.10 |
| Borrow | ~$0.10 |
| Repay | ~$0.10 |
| Withdraw | ~$0.10 |

**Total for complete cycle:** ~$0.30-$0.40

---

## When to Borrow vs Mint (CDP)

### Choose Borrowing (Lending Pool) If:

- ✅ Short-term liquidity need (days/weeks)
- ✅ Want flexibility to add/remove collateral easily
- ✅ Comfortable with variable rates
- ✅ Need quick access

### Choose Minting (CDP) If:

- ✅ Long-term position (months)
- ✅ Want lower, more stable fees
- ✅ Maximizing capital efficiency
- ✅ Willing to manage vaults

**See:** **[Mint USDST via CDP Guide](mint-cdp.md)**

---

## Next Steps

### Earn While You Have USDST

- **[Provide Liquidity](liquidity.md)** - Earn fees on your USDST
- **[Swap Tokens](swap.md)** - Trade for other assets
- **[Earn Rewards](rewards.md)** - Claim Reward Points

### Learn More

- **[Core Concepts](../concepts.md)** - Health Factor, liquidation, etc.
- **[Safety Guide](../safety.md)** - Risk management
- **[FAQ](../faq.md)** - Common questions

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)
