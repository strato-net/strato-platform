# Withdrawals: Bridge Assets Back to Ethereum

Simple guide to withdrawing your assets from STRATO back to Ethereum.

---

## Overview

You can withdraw assets from STRATO back to Ethereum at any time. You have two withdrawal options depending on your asset type.

!!! warning "Important"
    - All withdrawals require **approval** by the bridge
    - Withdrawals are **not instantaneous** (typically 10-30 minutes)
    - You can withdraw assets **while keeping positions open** on STRATO

---

## What You Can Withdraw

You can withdraw **any assets in your wallet** on STRATO:

- ✅ Tokens sitting in your wallet (not locked as collateral)
- ✅ Assets after removing liquidity positions
- ✅ Tokens after repaying debts and withdrawing collateral

!!! note "Collateral Cannot Be Withdrawn"
    Assets locked as collateral in Lending or CDP positions cannot be directly withdrawn. To withdraw collateral:
    1. Repay the associated debt
    2. Withdraw the collateral to your wallet
    3. Then bridge it to Ethereum
    
    **Or:** Keep your positions active and only withdraw free assets

---

## Option 1: Withdraw USDST as Stablecoins

**Best for:** Users who want to exit with stablecoins

### What You Get

USDST on STRATO can be withdrawn as:
- **USDC** on Ethereum, or
- **USDT** on Ethereum

Both maintain the same value (1:1 peg).

### How to Withdraw

1. **Go to Withdrawals** (in sidebar)
2. **From:** STRATO → **To:** Ethereum
3. **Asset:** Select **USDST**
4. **Withdraw as:** Choose **USDC** or **USDT**
5. **Amount:** Enter amount to withdraw
6. **Review:**
   - STRATO transaction fee: ~$0.10
   - Ethereum claim gas: ~$15-30 (paid when claiming)
   - Processing time: 10-30 minutes
7. **Click "Request Withdrawal"**
8. **Approve transaction**

### Claiming on Ethereum

**After 10-30 minutes:**

1. Your withdrawal will be ready to claim
2. Go to Ethereum and visit the claim page
3. Pay Ethereum gas (~$15-30) to claim your USDC/USDT
4. Tokens arrive in your Ethereum wallet

!!! note "Withdrawal Timing"
    Withdrawals are subject to approval and are not instant. Typical processing time is 10-30 minutes, but may vary based on network conditions.

---

## Option 2: Withdraw Wrapped Tokens as Ethereum Assets

**Best for:** Users who want to exit with ETH, WBTC, or other Ethereum-native assets

### What You Get

STRATO wrapped tokens can be withdrawn as their Ethereum equivalents:

| STRATO Token | Ethereum Token |
|--------------|----------------|
| **ETHST** | **ETH** (or WETH) |
| **WBTCST** | **WBTC** |
| **GOLDST** | **GOLDST** |
| **SILVST** | **SILVST** |
| **sUSDSST** | **sUSDS** (Sky) |

### How to Withdraw

1. **Go to Withdrawals** (in sidebar)
2. **From:** STRATO → **To:** Ethereum
3. **Asset:** Select your asset (e.g., **ETHST**)
4. **Withdraw as:** Shows corresponding token (e.g., **ETH**)
5. **Amount:** Enter amount to withdraw
6. **Review:**
   - STRATO transaction fee: ~$0.10
   - Ethereum claim gas: ~$15-30 (paid when claiming)
   - Processing time: 10-30 minutes
7. **Click "Request Withdrawal"**
8. **Approve transaction**

### Claiming on Ethereum

**After 10-30 minutes:**

1. Your withdrawal will be ready to claim
2. Go to Ethereum and visit the claim page
3. Pay Ethereum gas (~$15-30) to claim your assets
4. Tokens arrive in your Ethereum wallet

!!! note "Withdrawal Timing"
    Withdrawals are subject to approval and are not instant. Typical processing time is 10-30 minutes, but may vary based on network conditions.

---

## Example: Partial Withdrawal

**Your position:**
- 10 ETHST collateral in Lending
- 5,000 USDST borrowed
- 5 ETHST sitting in wallet (free)
- 2,000 USDST sitting in wallet (free)

### You can withdraw:

**Option 1: Withdraw free assets only**
- Bridge 5 ETHST → 5 ETH on Ethereum
- Bridge 2,000 USDST → 2,000 USDC on Ethereum
- **Keep your lending position active**
- No need to close anything

**Option 2: Close position first, then withdraw**
- Repay 5,000 USDST debt (need to get more USDST first)
- Withdraw 10 ETHST collateral to wallet
- Bridge everything to Ethereum
- **Full exit from STRATO**

**Most users choose Option 1** - withdraw some assets while keeping positions active.

---

## Optional: Closing Positions

If you want to withdraw collateral, you'll need to close positions first. Here's how:

### Close Liquidity Positions

1. **Go to Advanced → Swap Pools tab**
2. Find your liquidity position
3. **Click "Remove Liquidity"**
4. Enter **100%** (remove all)
5. **Confirm** (~$0.10 gas)
6. Wait 1-2 seconds
7. Repeat for all pools

**Result:** Underlying tokens returned to your wallet

---

### Repay Lending Debt

1. **Go to Borrow** (sidebar)
2. Find your borrowed asset
3. **Click "Repay" in the table**
4. Enter amount (or click "Repay Max")
5. **Confirm** (~$0.10 gas)

**Result:** Debt cleared, can now withdraw collateral

---

### Burn CDP Debt

1. **Go to Advanced → Mint tab**
2. Find your CDP vault
3. **Click "Repay"** (burns USDST)
4. Enter amount (or click "Repay Max")
5. **Confirm** (~$0.10 gas)

**Result:** CDP debt cleared

---

### Withdraw Collateral

**From Lending:**
1. **Go to Borrow** (sidebar)
2. Find your collateral
3. **Click "Withdraw" in the table**
4. Enter amount (or click "Withdraw Max")
5. **Confirm** (~$0.10 gas)

**From CDP:**
1. **Go to Advanced → Mint tab**
2. Find your vault
3. **Click "Withdraw"**
4. Enter amount (or click "Withdraw Max")
5. **Confirm** (~$0.10 gas)

**Result:** All collateral back in your wallet

---

## Costs & Timing

### Transaction Costs

| Action | Cost |
|--------|------|
| Close positions on STRATO | $0.50 - $1.50 |
| Request withdrawal | ~$0.10 |
| Claim on Ethereum | $15-30 (Ethereum gas) |
| **Total per withdrawal** | **~$15-32** |

### Time Required

| Step | Time |
|------|------|
| Close all positions | 10-20 min |
| Request withdrawal | 2 min |
| **Wait for approval** | **10-30 min** |
| Claim on Ethereum | 5 min |
| **Total** | **~30-60 min** |

---

## Important Notes

### About Withdrawal Approvals

!!! warning "Approval Process"
    - All withdrawals must be **approved by the bridge**
    - Approvals typically take **10-30 minutes**
    - During high network congestion, may take longer
    - You cannot cancel once submitted
    - Check withdrawal status on the Withdrawals page

### About Gas Costs

- **STRATO gas:** Very cheap (~$0.10 per transaction)
- **Ethereum gas:** Expensive ($15-30 per claim)
- **Tip:** Batch multiple withdrawals if possible to save on Ethereum gas

### About Asset Conversions

- **USDST → USDCST/USDT:** 1:1 conversion (no slippage)
- **ETHST → ETHST:** 1:1 conversion (no slippage)
- **Wrapped tokens:** Always convert back to original Ethereum asset

---

## Common Issues

### "Cannot bridge collateral"

**Problem:** Asset is locked as collateral

**Solution:**
- Option A: Close position (repay debt, withdraw collateral, then bridge)
- Option B: Keep position active, only bridge free assets in your wallet

---

### "Insufficient balance"

**Problem:** Don't have enough USDST to repay debt

**Fix:**
- Remove liquidity first to get USDST
- Swap other assets to USDST
- Or bridge in more USDC from Ethereum

---

### "Withdrawal taking too long"

**Problem:** Approval is delayed

**Normal:**
- 10-30 minutes is standard
- Can be longer during congestion

**Check:**
- Go to Withdrawals page
- View pending status
- If > 1 hour, contact support

---

## Partial Withdrawals

You don't have to withdraw everything:

**Common scenarios:**
1. **Withdraw profits** - Bridge out gains while keeping positions active
2. **Emergency funds** - Bridge some assets to Ethereum, keep most on STRATO
3. **Rebalancing** - Withdraw some assets, bridge in others
4. **Taking profits** - Withdraw trading gains, keep core positions

**Example:**
- Earned 2 ETHST in yield
- Bridge 2 ETHST to Ethereum (take profits, receive 2 ETH)
- Keep 10 ETHST lending position active on STRATO
- No need to close anything

---

## Bridge Back Anytime

**Withdrawing doesn't mean you're leaving!**

**You can:**
- Withdraw and bridge back anytime
- Keep positions active while withdrawing other assets
- Bridge in more assets whenever needed
- No penalties for withdrawals

**Common pattern:**
- Withdraw profits to Ethereum periodically
- Keep core positions active on STRATO
- Bridge in more when opportunities arise

---

## Next Steps

**After successful withdrawal:**

### Continue using STRATO:
- Keep your positions active
- Bridge in more assets when needed
- Withdraw profits periodically

### Take a break:
- Withdrawn assets safe in your Ethereum wallet
- Positions remain active on STRATO (if you kept them)
- Bridge back anytime

### Need more assets on STRATO?
- Bridge assets back (reverse process)
- Use the Deposits page to bridge in
- Welcome back anytime! 👋

---

## Related Guides

- **[Bridge Guide](../guides/bridge.md)** - Detailed bridge instructions
- **[Borrow Guide](../guides/borrow.md)** - How to repay debts
- **[CDP Guide](../guides/mint-cdp.md)** - How to close CDP positions
- **[Safety Guide](../safety.md)** - Risk management

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)
