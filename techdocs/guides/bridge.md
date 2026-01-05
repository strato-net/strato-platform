# Bridge Assets

Transfer assets between Ethereum and STRATO networks.

!!! note "Variable Timing & Costs"
    Bridge timing, gas costs, and confirmation times shown are typical estimates. Actual values may vary significantly based on network congestion, block confirmation times, and current gas prices. Ethereum gas fees can range from $5-100+ depending on network conditions.

---

## Complete Example: Bridge 0.5 ETH to STRATO

**Your situation:**

- You have: 0.5 ETH on Ethereum mainnet
- You want: Use it on STRATO for DeFi

**What you'll do:**

1. Initiate bridge from Ethereum
2. Wait for bridge processing (~10-15 min)
3. Receive ETH on STRATO
4. Start using it

**Time needed:** 15-20 minutes  
**Total cost:** ~$15-30 Ethereum gas + $0.10 STRATO gas

---

### Quick Walkthrough

**Step 1: Initiate Bridge**
- Go to **Deposits** (in sidebar) → **Bridge In** tab (for deposits) OR **Withdrawals** (in sidebar) for withdrawals
- From: **Ethereum** → To: **STRATO**
- Asset: **ETH**
- Amount: **0.5**
- Review: Gas ~$20 (Ethereum), STRATO fee ~$0.10

**Step 2: Approve & Confirm**
- Click **"Bridge"**
- Confirm in wallet (pay Ethereum gas)
- Transaction submitted

**Step 3: Wait for Processing**
- Ethereum confirmation: 1-2 minutes
- Bridge processing: 10-15 minutes
- Track status in Bridge page

**Step 4: Receive on STRATO**
- Assets arrive automatically
- Check STRATO wallet

**Result:**
```
✅ Bridged: 0.5 ETH from Ethereum to STRATO
✅ Time: ~15 minutes total
✅ Cost: ~$20 Ethereum gas + $0.10 STRATO fee
✅ Received: 10 FREE transaction vouchers
✅ Ready to use on STRATO
```

**Your wallet:**

- Ethereum: 0.5 ETH less
- STRATO: 0.5 ETHST more (now usable for DeFi)
- STRATO: 10 vouchers (for free transactions)

!!! tip "Free Transactions"
    Every time you bridge assets to STRATO, you receive **10 free transaction vouchers**. Each voucher covers one transaction fee. After using all vouchers, transactions cost only 0.01 USDST (~$0.01) each.

---

## Overview

**What is bridging?**
- Move tokens from Ethereum mainnet to STRATO
- Transfer tokens from STRATO back to Ethereum
- Enables use of your existing assets on STRATO
- Secure, decentralized cross-chain transfers

**Why bridge to STRATO?**
- **Lower fees**: < $0.10 per transaction vs. $5-50+ on Ethereum
- **Faster**: 1-2 second finality vs. 12+ seconds
- **DeFi access**: Use assets for borrowing, swapping, liquidity
- **Earn rewards**: Participate in STRATO DeFi ecosystem

---

## Prerequisites

Before bridging:

- [ ] Web3 wallet installed (MetaMask recommended)
- [ ] Assets on Ethereum mainnet (or destination chain)
- [ ] ETH for Ethereum gas fees ($5-50 depending on congestion)
- [ ] Small USDST for STRATO gas fees (if bridging back)
- [ ] ~10-15 minutes for bridge completion

---

## Supported Assets

### From Ethereum to STRATO

Common bridgeable assets:

- **ETH** → ETHST
- **USDC** → USDC (on STRATO)
- **USDT** → USDT (on STRATO)
- **WBTC** → WBTCST
- **Other ERC20 tokens** (check bridge interface for full list)

### Token Naming

- **On Ethereum**: Original name (ETH, USDC, WBTC)
- **On STRATO**: May have ST suffix (ETHST, WBTCST) or same name
- **Same value**: 1:1 peg (1 ETH on Ethereum = 1 ETHST on STRATO)

---

## Bridge Fees

### Ethereum → STRATO

- **Ethereum gas**: $5-50+ (varies with network congestion)
- **STRATO fee**: Minimal (< $0.10 in USDST)

**Cost optimization**:

- Bridge during low gas hours (late night/weekends UTC)
- Use gas trackers (etherscan.io/gastracker)
- Bridge larger amounts to amortize fees

### STRATO → Ethereum

- **STRATO fee**: < $0.10 in USDST
- **Ethereum gas**: Paid when claiming on Ethereum

---

## Step-by-Step: Bridge to STRATO

### Step 1: Prepare Your Wallet

1. Ensure MetaMask (or wallet) is installed and unlocked
2. Connect to **Ethereum Mainnet** network
3. Verify you have:

   - Assets to bridge
   - ETH for gas fees (~$10-30 extra)

### Step 2: Go to Bridge

1. Navigate to **Bridge** section in STRATO app
2. Or visit bridge interface directly
3. Connect wallet (may need to switch to Ethereum network)

### Step 3: Select Bridge Direction

- **From**: Ethereum Mainnet
- **To**: STRATO

### Step 4: Choose Asset and Amount

1. **Select token** to bridge (e.g., USDC)
2. **Enter amount** to transfer
3. Review:

   - **You send**: Amount on Ethereum
   - **You receive**: Amount on STRATO (minus fees)
   - **Estimated time**: ~10-15 minutes
   - **Gas estimate**: Current Ethereum gas cost

**Minimum amounts**: Check minimum bridge amount (typically ~$50-100)

!!! tip "Start Small"
    Bridge a small test amount first (~$100) to verify the process works before transferring larger amounts.

### Step 5: Initiate Bridge

1. Click **Bridge** or **Transfer**
2. Review transaction details in wallet
3. **Check gas fee** - if too high, wait for lower gas
4. Confirm transaction
5. Wait for Ethereum confirmation (12-60 seconds)

### Step 7: Wait for Bridge Completion

**Timeline**:

- **Ethereum confirmation**: 12-60 seconds
- **Bridge processing**: 5-10 minutes
- **STRATO arrival**: Automatic

**Track progress**:

- Bridge interface shows status
- Check transaction hash on Etherscan
- Monitor STRATO wallet balance

✅ **Complete!** Assets appear in STRATO wallet (15-20 minutes total).

---

## Step-by-Step: Bridge to Ethereum

### Step 1: Switch to STRATO Network

1. Open MetaMask
2. Switch to **STRATO** network
3. Verify you have assets to bridge + USDST for gas

### Step 2: Go to Bridge

1. Navigate to **Bridge** section
2. Connect wallet (should be on STRATO)

### Step 3: Select Bridge Direction

- **From**: STRATO
- **To**: Ethereum Mainnet

### Step 4: Choose Asset and Amount

1. Select token (e.g., ETHST → ETH)
2. Enter amount
3. Review details and fees

### Step 5: Initiate Bridge

1. Click **Bridge**
2. Confirm on STRATO (< $0.10 gas in USDST)
3. Wait for confirmation (1-2 seconds)

### Step 6: Claim on Ethereum

After STRATO transaction confirms:

1. **Wait for bridge processing** (~10-15 minutes)
2. **Switch to Ethereum Mainnet** in wallet
3. **Go to bridge interface** → "Claim" section
4. Click **Claim [Token]**
5. Pay Ethereum gas fee to finalize
6. Tokens arrive in Ethereum wallet

!!! note "Two-Step Process"
    Bridging to Ethereum requires two transactions: one on STRATO (to initiate) and one on Ethereum (to claim). This is standard for cross-chain bridges.

---

## Tracking Your Bridge

### In-Progress Bridges

**Check status**:

1. Go to **Deposits** (sidebar) → **Bridge In** tab → **History** OR go to **Withdrawals** (sidebar) → **History**
2. View active transfers
3. See estimated completion time
4. Click transaction hash for blockchain explorer

**Status indicators**:

- ⏳ **Pending**: Waiting for confirmations
- 🔄 **Processing**: Bridge validators working
- ✅ **Complete**: Assets transferred
- ❌ **Failed**: Transaction reverted (rare)

### Bridge History

View all past bridges:

- **Date/time** of transfer
- **Amount** and token
- **Direction** (Ethereum → STRATO or reverse)
- **Transaction hashes** (both chains)
- **Status** and completion

---

## Common Issues

### "Bridge taking too long"

**Normal duration**: 10-20 minutes total

**If delayed (> 30 minutes)**:

- Verify Ethereum transaction confirmed (check Etherscan)
- Ensure sufficient gas was paid
- Check bridge status page for delays
- Contact support with transaction hash

### "Insufficient ETH for gas"

**Cause**: Not enough ETH to pay Ethereum gas fees

**Fix**:

- Get more ETH to your Ethereum wallet
- Wait for lower gas prices
- Try again with sufficient ETH balance

### "Transaction failed" / Reverted

**Causes**:

- Gas limit too low
- Token not supported
- Amount below minimum
- Smart contract error

**Fix**:

- Check error message on Etherscan
- Verify token is supported
- Ensure amount > minimum
- Try again or contact support

### "Cannot claim on Ethereum"

**Cause**: Bridge not fully processed yet

**Fix**:

- Wait full 15-20 minutes from initiation
- Refresh bridge page
- Check if claim button appears
- Verify you're on Ethereum network in wallet

---

## Best Practices

### Before Bridging

- [ ] Check current Ethereum gas prices
- [ ] Calculate total cost (gas + bridge fees)
- [ ] Verify sufficient balance (amount + gas)
- [ ] Start with small test amount
- [ ] Bookmark official bridge URL

### During Bridging

- [ ] Double-check token selection
- [ ] Verify destination network
- [ ] Review gas fee (cancel if too high)
- [ ] Save transaction hashes
- [ ] Don't close browser during process

### After Bridging

- [ ] Verify assets arrived
- [ ] Check balance on destination chain
- [ ] Save transaction records
- [ ] Report any issues promptly

---

## Security

### Protect Yourself

- ✅ **Verify URLs**: Only use official STRATO bridge
- ✅ **Check token addresses**: Ensure correct token contracts
- ✅ **Start small**: Test with small amounts first
- ✅ **Save transaction hashes**: For tracking and support

### Red Flags

- ❌ **Unofficial bridge URLs**
- ❌ **"Too good to be true" offers** (airdrops, bonuses)
- ❌ **Requests for seed phrase** (never share!)
- ❌ **Unverified token contracts**

### Official Resources

- **STRATO App**: [https://app.strato.nexus/](https://app.strato.nexus/)
- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)

---

## Cost Optimization

### When to Bridge

**Best times for lower Ethereum gas**:

- Weekends (Saturday-Sunday)
- Late night UTC (2-6 AM)
- During low network activity

**Check gas prices**: 

- [Etherscan Gas Tracker](https://etherscan.io/gastracker)
- Target: < 30 gwei for reasonable fees

### Batch Transfers

Instead of multiple small bridges:

- Bridge larger amounts less frequently
- Amortizes fixed costs across more value
- Fewer approval transactions

**Example**:

- ❌ Bridge $100 five times = 5× gas fees
- ✅ Bridge $500 once = 1× gas fee

### Alternative Routes

For large amounts:

- Consider centralized exchange (CEX) if available
- Direct STRATO deposit from CEX
- May save on Ethereum gas fees

---

## Understanding Bridge Mechanics

### How It Works

1. **Lock on Source**: Tokens locked in source chain contract
2. **Validators Sign**: Bridge validators confirm transaction
3. **Mint on Destination**: Equivalent tokens minted on destination
4. **Unlock**: Original tokens unlocked when bridging back

### Security Model

- **Multi-sig validators**: Multiple parties must approve
- **Time locks**: Delays prevent instant theft
- **Audited contracts**: Security-reviewed code
- **Decentralized**: No single point of failure

### 1:1 Peg

- 1 ETH on Ethereum = 1 ETHST on STRATO
- Value maintained across chains
- Can always bridge back 1:1

---

## What's Next?

### Start Using Your Assets

Now that assets are on STRATO:

- **[Borrow USDST](borrow.md)** - Get liquidity against your bridged assets
- **[Swap Tokens](swap.md)** - Trade between different tokens
- **[Provide Liquidity](liquidity.md)** - Earn fees with your assets

### Explore More

- **[Quick Start Guide](../quick-start.md)** - Complete setup guide
- **[Core Concepts](../concepts.md)** - Understand DeFi fundamentals
- **[Safety Guide](../safety.md)** - Security best practices

---

## Need Help?

- **FAQ**: [Bridge Questions](../faq.md#getting-started)
- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **API Reference**: [Interactive API (Swagger)](../reference/interactive-api.md)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)

