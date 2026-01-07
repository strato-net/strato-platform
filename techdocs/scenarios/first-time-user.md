# First-Time User Journey

Complete walkthrough from getting assets onto STRATO to your first DeFi transaction.

---

## Your Goal

Get your crypto onto STRATO and borrow USDST to start using DeFi.

**What you have:**

- 1 ETH on Ethereum mainnet
- MetaMask wallet

**What you'll achieve:**

- Bridge ETH to STRATO
- Use it as collateral
- Borrow 500 USDST
- Start using STRATO DeFi

**Time needed:** 30 minutes (mostly waiting for bridge)  
**Total cost:** ~$21 (Ethereum gas + STRATO fees)

---

## Complete Walkthrough

### Part 1: Bridge Your Assets (15-20 minutes)

**Step 1: Go to Deposits Page**

1. Visit [https://app.strato.nexus/bridge](https://app.strato.nexus/bridge)
2. Connect your MetaMask wallet
3. Ensure you're on **Ethereum Mainnet** network

**Step 2: Initiate Bridge**

1. From: **Ethereum** → To: **STRATO**
2. Asset: **ETH**
3. Amount: **1.0**
4. Review costs:

   - Ethereum gas: ~$20 (varies with congestion)
   - Bridge fee: ~$1
   - Total: ~$21

**Step 3: Confirm & Wait**

1. Click **"Bridge"**
2. Confirm transaction in MetaMask
3. Wait for:

   - Ethereum confirmation: 1-2 minutes
   - Bridge processing: 10-15 minutes
4. Track status in Bridge page

**Result:**
```
✅ Bridged: 1 ETH from Ethereum to STRATO
✅ Time: ~15 minutes
✅ Cost: ~$21
✅ Now have: 1 ETHST on STRATO
```

**While waiting:**

- Add STRATO network to MetaMask (bridge page will prompt)
- Switch to STRATO network in wallet
- Read [Core Concepts](../concepts.md) to understand health factor

---

### Part 2: Add STRATO Network to MetaMask

**The bridge page should auto-prompt, but if not:**

1. Open MetaMask → Networks → **Add Network**
2. Enter details:

   - Network Name: **STRATO**
   - RPC URL: `https://app.strato.nexus/strato-api/eth/v1.2`
   - Chain ID: (auto-detected)
   - Currency: **ETH**
3. Click **Save**
4. Switch to STRATO network

**Verify:**

- You should see **1 ETHST** in your wallet
- Network shows "STRATO" at top of MetaMask

---

### Part 3: Get USDST for Fees (5 minutes)

**Problem:** You need USDST to pay gas fees on STRATO

**Solution:** Quick borrow to get gas fees

1. **Go to Borrow page** (in sidebar)
2. **Try to supply ETH as collateral:**

   - In the Collateral Management table, find **ETHST**
   - Click the **"Supply"** button
   - Enter **0.1** (keep 0.9 for now)
   - Click **"Supply"** → Confirm
   - Wait... **ERROR: Need USDST for gas!**

**Catch-22 Solution:**

- Request USDST from faucet (if testnet)
- OR get from a friend
- OR use the app's "Get Gas" feature if available
- OR bridge in USDC first, swap for USDST

**For this guide, assume you got 10 USDST for fees.**

---

### Part 4: Supply Collateral (2 minutes)

**Now you have gas, let's continue:**

**Step 1: Supply ETH**

1. Go to **Borrow** (sidebar)
2. **In the Collateral Management table**, find **ETHST**
3. Click the **"Supply"** button
4. **In the modal:**
   - Enter **1.0** (use all of it)
   - Review the preview
5. Click **"Supply"**
   - Confirm (~$0.10 gas in USDST)
   - Approval + supply happen automatically in one transaction
   - Wait 1-2 seconds

**Result:**
```
✅ Supplied: 1 ETHST ($3,000)
✅ Can borrow: Up to $2,250 USDST
✅ Health Factor: N/A (no debt yet)
```

**Your balances:**

- ETHST: 0 (moved to collateral)
- USDST: 9.90 (spent $0.10 on gas for one transaction)
- Collateral: 1 ETHST

---

### Part 5: Borrow USDST (2 minutes)

**Step 1: Borrow**

1. Go to **Borrow** (sidebar) → **Borrow** section
2. Enter **500** USDST
3. Review:

   - Borrowing: 500 USDST
   - New Health Factor: **3.6** (very safe)
   - Interest: ~5% annually
4. Click **"Borrow"**
   - Confirm (~$0.10 gas)
   - Wait 1-2 seconds

**Result:**
```
✅ Borrowed: 500 USDST
✅ Health Factor: 3.6 (Very safe)
✅ Your wallet: +500 USDST
```

**Your balances:**

- ETHST: 0
- USDST: 509.70 (9.70 remaining + 500 borrowed)
- Collateral: 1 ETHST ($3,000)
- Debt: 500 USDST

---

## Summary: What You Achieved

**Starting point:**

- 1 ETH on Ethereum

**Ending point:**

- 1 ETHST as collateral on STRATO
- 509.70 USDST in wallet
- Health Factor: 3.6 (very safe)
- Ready to use STRATO DeFi

**Total costs:**

- Ethereum gas: ~$20
- Bridge fee: ~$1
- STRATO gas: ~$0.30
- **Total: ~$21.30**

**What you can do now:**

- ✅ Use USDST for transaction fees
- ✅ Swap USDST for other tokens
- ✅ Provide liquidity and earn fees
- ✅ Keep borrowing against collateral
- ✅ Earn Reward Points

---

## Next Steps

### Option A: Start Trading

**[Swap USDST for other tokens →](../guides/swap.md)**
- Trade for any token on STRATO
- Build your portfolio
- Take advantage of opportunities

### Option B: Earn Passive Income

**[Provide Liquidity →](../guides/liquidity.md)**
- Use your USDST to provide liquidity
- Earn 8-15% APR in trading fees
- Plus Reward Points

### Option C: Expand Your Position

**[Borrow More →](../guides/borrow.md)**
- You can borrow up to $2,250 total
- Currently using only $500
- Health factor is very safe at 3.6

### Option D: Try CDP for Lower Fees

**[Mint via CDP →](../guides/mint-cdp.md)**
- Lower fees than borrowing
- Better for long-term positions
- More capital efficient

---

## Important Reminders

### Monitor Your Health Factor

**Check daily:**

1. Go to **Borrow** (sidebar)
2. See your health factor
3. Keep it above 2.0

**If ETH price drops:**

- Health factor decreases
- Add more collateral or repay debt
- Don't let it drop below 1.0!

### Keep USDST for Gas

**Always maintain:**

- At least 10-20 USDST in wallet
- For transaction fees
- Gas is cheap (~$0.10) but you need it

### Accrue Interest

**Remember:**

- Your 500 USDST debt grows daily
- ~5% annually = $0.07/day
- After 30 days: Owe ~$502
- Track and repay when ready

---

## Common Questions

### "How do I get more ETH on STRATO?"

Bridge more from Ethereum:

1. Follow Part 1 again
2. Bridge additional ETH
3. Supply as collateral

### "Can I withdraw my ETH?"

Only if you maintain health factor above 1.0:

1. Repay your debt first (or partially)
2. Then withdraw collateral
3. Health factor must stay safe

### "What if I need to exit completely?"

See **[Withdrawals Guide →](withdrawals.md)**

---

## Troubleshooting

### Bridge taking too long

**Normal:** 15-20 minutes total

**If > 30 minutes:**

- Check Ethereum transaction confirmed on Etherscan
- Contact support with transaction hash
- Monitor bridge status page

### "Insufficient USDST for transaction fee"

**Problem:** Ran out of gas USDST

**Solution:**

- Get more USDST (borrow small amount, or swap)
- Ask in community for small amount
- Use faucet if on testnet

### Health factor warnings

**If health factor drops below 2.0:**

1. Check ETH price movement
2. Add more collateral or repay debt
3. Don't ignore yellow/red warnings

---

## Congratulations! 🎉

You've successfully:

- ✅ Bridged assets to STRATO
- ✅ Supplied collateral
- ✅ Borrowed USDST
- ✅ Ready for DeFi

**You're now a STRATO user!**

### Continue Your Journey

- **[Core Concepts](../concepts.md)** - Deepen your understanding
- **[Safety Guide](../safety.md)** - Protect your assets
- **[All Guides](../guides/borrow.md)** - Explore more features
- **[FAQ](../faq.md)** - Common questions

### Get Help

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)

