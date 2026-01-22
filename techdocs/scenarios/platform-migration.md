# Migrating from Other DeFi Platforms

Move your positions from Aave, Compound, MakerDAO, or other platforms to STRATO.

---

## Why Migrate to STRATO

**Cost savings:**

- Lower interest rates (2.5-5% vs 5-15% elsewhere)
- Cheaper gas fees (< $0.10 vs $20-50 on Ethereum)
- No ETHST gas for transactions (USDST-based)

**Additional features:**

- Separate systems: Lending (CollateralVault) and CDP (CDPVault)
- Built-in DEX for swaps
- Cross-chain bridge
- Reward Points

**Expected savings:** $500-2,000/year on typical $20k position

---

## Complete Example: Migrating from Aave

**Your current Aave position:**

- Supplied: 10 ETH collateral on Ethereum (Aave)
- Borrowed: 15,000 USDC on Ethereum (Aave)
- Health Factor: 1.6
- Annual interest: ~$1,200 (8% on borrowed amount)

**Goal:** Recreate position on STRATO with lower costs

**Time needed:** 45 minutes  
**Cost:** ~$60-80 (mostly Ethereum gas)

---

## Migration Strategies

### Strategy 1: Clean Break (Recommended)

**Best for:** Most users

**Steps:**

1. Close all positions on old platform
2. Withdraw assets
3. Bridge to STRATO
4. Recreate positions

**Pros:** Clean, simple, no overlap  
**Cons:** Out of market during migration

---

### Strategy 2: Parallel Positions

**Best for:** Large positions, don't want downtime

**Steps:**

1. Bridge new capital to STRATO
2. Open positions on STRATO
3. Gradually close old platform
4. Bridge more assets over

**Pros:** Stay in market, test STRATO first  
**Cons:** Need extra capital, more complex

---

## Step-by-Step: Clean Break Migration

### Phase 1: Close Position on Aave (15 min)

**Step 1: Assess Current Position**

1. Go to **Aave** → **Dashboard**
2. Note your metrics:

   - Collateral: 10 ETH (on Aave/Ethereum)
   - Borrowed: 15,000 USDC (on Aave/Ethereum)
   - Health Factor: 1.6
   - Accrued interest: Check total owed

**Step 2: Repay Borrowed USDC**

**Options to get USDC:**

- A) Use USDST you already have
- B) Bridge USDC from another chain
- C) Sell some ETHST collateral first
- D) Add new funds

**For this example: Use existing USDC**

1. Go to **Aave** → **Repay**
2. Asset: **USDC**
3. Amount: **15,000** (or "Repay Max")
4. Confirm transaction
5. Pay Ethereum gas: ~$20-40
6. Wait for confirmation

**Result:**
```
✅ Repaid: 15,000 USDST ✅ Health Factor: N/A (no debt)
✅ Ethereum gas paid: ~$30
```

**Step 3: Withdraw All Collateral**

1. Go to **Aave** → **Withdraw**
2. Asset: **ETH**
3. Amount: **10** (withdraw all)
4. Confirm transaction
5. Pay gas: ~$15-25

**Result:**
```
✅ Withdrawn: 10 ETHST to wallet
✅ Aave position: Closed
✅ Total Ethereum gas: ~$45-65
```

---

### Phase 2: Bridge to STRATO (20 min)

**Step 1: Initiate Bridge**

1. Go to **Deposits** (in sidebar) → **Bridge In** tab
2. From: **Ethereum** → To: **STRATO**
3. Asset: **ETH**
4. Amount: **10.0**
5. Review costs:

   - Ethereum gas: ~$15-25
6. Confirm and pay
7. Wait 10-15 minutes

**Result:**
```
✅ Bridged: 10 ETH to STRATO
✅ Total bridge cost: ~$15-25
```

**Optional: Bridge USDC for Repayment Later**

If you want to recreate borrowing position:

- Keep USDC on Ethereum
- Bridge when you need to repay STRATO debt
- Or swap on STRATO instead

---

### Phase 3: Recreate Position on STRATO (10 min)

**Step 1: Supply Collateral**

1. Go to **Borrow** (in sidebar)
2. In Collateral Management table, find **ETHST** → Click **"Supply"**
3. Enter amount: **10.0**
4. Click **"Supply"** (~$0.10 gas in USDST, approval automatic)

**Result:**
```
✅ Collateral: 10 ETHST ($30,000)
✅ Can borrow: Up to $22,500 (75% LTV)
```

**Step 2: Borrow USDST**

1. Go to **Borrow** (in sidebar) → **Borrow** section
2. Amount: **15,000** USDST (same as before)
3. Check Health Factor: ~1.6 (same as Aave)
4. Click **"Borrow"** (~$0.10 gas)

**Result:**
```
✅ Borrowed: 15,000 USDST
✅ Health Factor: 1.6 (same safety)
✅ Position recreated!
```

**Step 3: Optional - Swap to USDC**

If you need USDST instead of USDST:

1. Swap 15,000 USDST → USDST (~0.3% fee)
2. Now you have same asset as before

---

## Your New Position

### Comparison: Aave vs STRATO

| Metric | Aave (Ethereum) | STRATO |
|--------|-----------------|---------|
| **Collateral** | 10 ETHST | 10 ETHST |
| **Borrowed** | 15,000 USDST | 15,000 USDST |
| **Health Factor** | 1.5 | 1.5 |
| **Interest Rate** | ~8% | ~5% |
| **Annual Interest** | $1,200 | $750 |
| **Gas per tx** | $20-50 | < $0.10 |
| **Annual savings** | - | **$450 + gas** |

**Total annual savings: ~$500-1,000** ✅

---

## Platform Comparison Matrix

### Feature Comparison

| Feature | Aave | Compound | MakerDAO | STRATO |
|---------|------|----------|----------|---------|
| **Interest Rate** | 5-12% | 6-15% | 1-5% (SF) | 2.5-5% |
| **Gas Costs** | $20-50 | $20-50 | $30-60 | < $0.10 |
| **CDP System** | ❌ | ❌ | ❌ | ✅ |
| **Built-in DEX** | ❌ | ❌ | ❌ | ✅ |
| **Rewards** | AAVE | COMP | ❌ | Reward Points |
| **CDP Available** | ❌ | ❌ | ✅ | ✅ |
| **Flash Loans** | ✅ | ❌ | ❌ | Coming |
| **Mobile App** | ✅ | ❌ | ❌ | ✅ |

---

## Migration Cost Breakdown

**One-time migration costs:**

| Action | Cost |
|--------|------|
| Repay Aave debt | ~$30 (ETH gas) |
| Withdraw from Aave | ~$20 (ETH gas) |
| Bridge to STRATO | ~$20 (ETH gas) |
| Supply on STRATO | ~$0.10 (USDST gas) |
| Borrow on STRATO | ~$0.10 (USDST gas) |
| **Total migration cost** | **~$70-80** |

**Break-even timeline:**

```
Annual savings: $500-1,000
Migration cost: $70-80
Break-even: 1 month
```

**After 1 year:** Net savings of $420-920

---

## Special Case: Migrating from MakerDAO

**MakerDAO uses Vaults (CDP), similar to STRATO CDP**

### Step-by-Step

1. **Close MakerDAO Vault:**

   - Repay DAI debt
   - Withdraw collateral
   - Pay Ethereum gas (~$40-60)

2. **Bridge to STRATO:**

   - Bridge ETH or other collateral
   - Cost: ~$20

3. **Open STRATO CDP:**

   - Supply collateral
   - Mint USDST (similar to minting DAI)
   - Cost: ~$0.20

**Key difference:**

- MakerDAO: Stability fee 1-5%
- STRATO: Stability fee 2.5%
- Similar economics, much cheaper gas

---

## Advanced: Parallel Position Migration

**For users who don't want downtime:**

### Week 1: Open STRATO Position

1. Bridge 50% of capital to STRATO
2. Open smaller position
3. Test the platform
4. Verify everything works

### Week 2: Scale Up STRATO

1. Bridge more assets
2. Increase STRATO position
3. Start earning rewards
4. Compare costs

### Week 3-4: Close Old Platform

1. Gradually repay old debts
2. Withdraw collateral in batches
3. Bridge to STRATO
4. Add to STRATO position

**Pros:**

- No market downtime
- Test STRATO first
- Flexibility to adjust

**Cons:**

- Pay interest on both platforms
- More complex to track
- Higher temporary capital requirement

---

## Tax Considerations

**Migration creates taxable events:**

**On Ethereum (Closing Aave):**

- Repaying debt: Not taxable
- Withdrawing collateral: Not taxable
- Any swaps: Taxable

**Bridging:**

- Bridge ETH→STRATO: Generally not taxable (same asset)
- But consult tax professional

**On STRATO (Opening Position):**

- Supply collateral: Not taxable
- Borrow USDST: Not taxable
- Swaps: Taxable

**Recommendation:**

- Keep transaction records
- Track cost basis
- Consult tax advisor
- Consider timing (tax year)

---

## Migration Checklist

### Before Migration

- [ ] Document current positions (screenshots)
- [ ] Calculate total debt including interest
- [ ] Have assets ready for repayment
- [ ] Check Ethereum gas prices (migrate when low)
- [ ] Ensure enough USDST for STRATO gas
- [ ] Add STRATO network to MetaMask
- [ ] Read STRATO docs

### During Migration

- [ ] Repay all debts on old platform
- [ ] Withdraw all collateral
- [ ] Verify transactions confirmed
- [ ] Bridge assets to STRATO
- [ ] Wait for bridge completion
- [ ] Open positions on STRATO
- [ ] Verify new Health Factor

### After Migration

- [ ] Confirm all old positions closed
- [ ] Set up monitoring for new positions
- [ ] Save transaction hashes
- [ ] Update spreadsheets/tracking
- [ ] Set price alerts
- [ ] Claim any remaining rewards on old platform

---

## Troubleshooting

### "Can't repay on Aave - insufficient balance"

**Problem:** Don't have enough borrowed asset

**Fix:**

- Bridge in the needed asset
- Or sell some collateral first (partially withdraw)
- Or add more funds from CEX

### "Bridge taking too long"

**Normal:** 10-20 minutes

**If > 30 min:**

- Check Ethereum tx confirmed (Etherscan)
- Contact STRATO support with tx hash
- Monitor bridge status page

### "Health Factor different on STRATO"

**Possible reasons:**

- Different LTV ratios (Aave: 80%, STRATO: 75%)
- Different liquidation thresholds
- Price oracle differences

**Fix:**

- Adjust borrowed amount to match comfort level
- Don't blindly copy exact amounts

---

## Real Migration Example

**User: Alice**

**Starting Position (Aave):**

- 5 ETHST collateral
- 7,500 USDST borrowed
- 8% interest = $600/year
- Monthly Ethereum gas: ~$50

**After Migration (STRATO):**

- 5 ETHST collateral
- 7,500 USDST borrowed
- 5% interest = $375/year
- Monthly STRATO gas: ~$1

**Alice's Results:**

| Metric | Aave | STRATO | Savings |
|--------|------|---------|---------|
| Interest/year | $600 | $375 | $225 |
| Gas/year | $600 | $12 | $588 |
| **Total/year** | **$1,200** | **$387** | **$813** |

**Migration cost:** $75  
**Break-even:** 1 month  
**Year 1 net savings:** $738

---

## Next Steps After Migration

### Optimize Your Position

- **[Maximize Yield](maximize-yield.md)** - Add liquidity providing
- **[Portfolio Rebalancing](portfolio-rebalancing.md)** - Diversify collateral

### Explore STRATO Features

- **[Provide Liquidity](../guides/liquidity.md)** - Earn trading fees
- **[Earn Rewards](../guides/rewards.md)** - Claim Reward Points
- **[Swap Tokens](../guides/swap.md)** - Built-in DEX

### Stay Updated

- Join Telegram for updates
- Monitor platform announcements
- Track your savings vs old platform

---

## Frequently Asked Questions

### "Should I migrate everything at once?"

**Recommendation:**

- Large positions (> $50k): Gradual migration
- Medium positions ($10-50k): Clean break
- Small positions (< $10k): Clean break

### "What if I need to go back?"

**You can:**

- Close STRATO positions
- Bridge back to Ethereum
- Reopen on old platform
- No lock-in period

### "Will I lose my AAVE/COMP rewards?"

**Yes:**

- Claim all rewards before closing
- But STRATO offers Reward Points
- Compare total APY including rewards

### "Can I migrate during high volatility?"

**Not recommended:**

- Wait for stable conditions
- Migration takes 45+ minutes
- Price swings can affect your positions
- Better to migrate during calm markets

---

## Summary

**Migration benefits:**

- ✅ Lower interest rates
- ✅ Dramatically lower gas costs
- ✅ Additional features (DEX, Bridge, CDP)
- ✅ Reward Points

**Migration costs:**

- ~$70-80 one-time
- Break-even in 1 month
- $500-1,000 annual savings

**Best for:**

- Active DeFi users
- Multi-month positions
- Cost-conscious users
- Anyone on Ethereum L1

---

## Need Help?

- **Migration Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Compare Rates**: [app.strato.nexus/rates](https://app.strato.nexus/rates)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)

