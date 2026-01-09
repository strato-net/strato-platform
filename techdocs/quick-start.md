# Quick Start Guide

Get started with STRATO DeFi in 10 minutes.

## What You'll Need

- **Web3 wallet** (MetaMask recommended)
- **Assets to bridge** from Ethereum (ETH, USDC, WBTC, etc.)
- **~$100-500** minimum (makes fees worthwhile)
- **10 minutes** of your time

!!! tip "New to DeFi?"
    Consider starting with **[Core Concepts](concepts.md)** to understand key terms like collateral, health factor, and liquidation before proceeding.

---

## Step 1: Register for STRATO Access

### Create Your Account

1. **Go to STRATO registration page:**

   - Visit [https://app.strato.nexus](https://app.strato.nexus)
   - Click on **"Register"** or **"Sign Up"** link
   - (This same account works for both testnet and mainnet)

2. **Fill out the registration form:**

   - **Email** - Your email address
   - **Username** - Choose a unique username
   - **First Name** - Your first name
   - **Last Name** - Your last name
   - **Password** - Create a strong password
   - **Confirm Password** - Re-enter your password

3. **Submit the form**
   - Click **"Register"** button

### Verify Your Email

After registration, you'll see a verification page:

!!! info "Email Verification Required"
    **Almost there!** Please check your inbox and verify your email to complete registration.

**Steps:**

1. **Check your email inbox**
   - Look for email from STRATO/BlockApps
   - Check spam/junk folder if not in inbox

2. **Click the verification link**
   - Open the verification email
   - Click the verification link
   - This activates your account

3. **If you don't receive the email:**

   - Wait a few minutes (emails can be delayed)
   - Click **"Click here to re-send the email"** on the verification page
   - Check spam/junk folders again

### Log In

Once your email is verified:

1. Go back to [https://app.strato.nexus](https://app.strato.nexus)
2. Click **"Log In"**
3. Enter your email/username and password
4. You're now ready to connect your wallet!

!!! note "Testnet vs Mainnet"
    **Same registration works for both!** Once registered, you can access:
    
    - **Testnet**: Practice with free test tokens - [testnet.strato.nexus](https://testnet.strato.nexus)
    - **Mainnet**: Real assets and value - [app.strato.nexus](https://app.strato.nexus)
    
    Start with testnet if you're new to DeFi!

!!! tip "Need Help?"
    If you encounter issues during registration:
    
    - **Support**: [support.blockapps.net](https://support.blockapps.net)
    - **Telegram**: [t.me/strato_net](https://t.me/strato_net)
    - **Documentation**: [docs.strato.nexus](https://docs.strato.nexus)

---

## Step 2: Set Up Your Wallet

### Install MetaMask (if needed)

1. Install [MetaMask browser extension](https://metamask.io)
2. Create new wallet and **securely save your seed phrase**
3. Never share your seed phrase with anyone

!!! danger "Critical Security Warning"
    Your seed phrase is the ONLY way to recover your wallet. Anyone with it can steal all your funds. Write it down and store it securely offline.

### Add STRATO Network

The STRATO app will auto-prompt you to add the network on first connection. Alternatively:

**Manual Setup:**

1. Open MetaMask → Network dropdown → "Add Network"
2. Enter network details:

**Mainnet:**

- **Network Name:** STRATO
- **RPC URL:** `https://app.strato.nexus/strato-api/eth/v1.2`
- **Chain ID:** (auto-detected)
- **Currency Symbol:** ETH
- **Block Explorer:** `https://app.strato.nexus/explorer`

**Testnet:**

- **Network Name:** STRATO Testnet
- **RPC URL:** `https://buildtest.mercata-testnet.blockapps.net/strato-api/eth/v1.2`
- **Chain ID:** (auto-detected)
- **Currency Symbol:** ETH

3. Click **Save**

---

## Step 3: Get Assets on STRATO

You need assets on STRATO to participate in DeFi. There are two ways to get them:

### Option A: Bridge from Ethereum (Mainnet)

1. Ensure you have assets on **Ethereum mainnet**
2. Go to **Deposits** (in sidebar) → **Bridge In** tab
3. Connect wallet to Ethereum network
4. Select asset and amount to bridge
5. Approve transaction on Ethereum (requires ETH for gas)
6. Wait for bridge confirmation (~5-15 minutes)
7. Assets appear in your STRATO wallet

!!! success "Bonus: Free Transaction Vouchers!"
    When you bridge in assets, you automatically receive **10 free transaction vouchers**. These cover your first 10 transactions on STRATO at no cost. After that, transactions cost only 0.01 USDST (~$0.01) each.

**Recommended first bridge:**

- 0.1-0.5 ETH (for collateral and fees)
- Or 500-1000 USDC (for stable collateral)

### Option B: Use Testnet Faucet (Testnet Only)

1. Switch to STRATO Testnet in your wallet
2. Go to Faucet page in app
3. Request test tokens (free)
4. Start experimenting!

!!! info "Understanding Wrapped Tokens"
    When you bridge assets to STRATO, they automatically become "wrapped" versions:
    
    - **ETH** → **ETHST** (Wrapped ETH on STRATO)
    - **USDC** → **USDCST** (Wrapped USDC on STRATO)
    - **WBTC** → **WBTCST** (Wrapped BTC on STRATO)
    
    These wrapped tokens work 1:1 with the original and are what you'll use for all STRATO operations (swaps, lending, collateral, etc.). When you bridge back to Ethereum, you receive the original tokens again.
    
    Learn more: **[Wrapped Tokens Concept](concepts.md#wrapped-tokens)**

---

## Step 4: Get USDST for Fees

STRATO transactions require USDST for gas fees (typically < $0.10 per transaction).

### Quick Ways to Get USDST:

**Method 1: Swap**
- Bridge USDC or USDT
- Swap for USDST on STRATO
- Keep 10-20 USDST for fees

**Method 2: Borrow Small Amount**
- Bridge collateral (ETH, WBTC)
- Borrow 20-50 USDST (see guides below)
- Use for transaction fees

**Method 3: Faucet (Testnet)**
- Request free USDST from testnet faucet

---

## Step 5: Test Everything

Before committing large amounts:

1. Start with small amount (~$50-100)
2. Try a simple swap
3. Check transaction confirms quickly
4. Verify fees are reasonable
5. Then proceed with larger operations

---

## What's Next?

### New to DeFi? Start Here:

!!! tip "First Time User"
    **[→ Complete First-Time User Guide](scenarios/first-time-user.md)** - Full walkthrough from getting assets onto STRATO to your first DeFi transaction.

**Or learn the fundamentals:**

- **[Core Concepts](concepts.md)** - Understand collateral, health factor, and liquidation
- **[Safety Practices](safety.md)** - Security and risk management essentials

---

### Ready to Use STRATO? Choose Your Feature:

!!! example "Core DeFi Features"
    - **[Borrow USDST](guides/borrow.md)** - Access liquidity against your collateral
    - **[Mint USDST via CDP](guides/mint-cdp.md)** - Create USDST with lower fees
    - **[Swap Tokens](guides/swap.md)** - Exchange assets instantly
    - **[Provide Liquidity](guides/liquidity.md)** - Earn fees as a liquidity provider
    - **[Bridge Assets](guides/bridge.md)** - Move assets cross-chain
    - **[Earn Rewards](guides/rewards.md)** - Claim Reward Points token rewards

---

### Want to Maximize Your Strategy?

!!! success "Popular Scenarios"
    - **[Maximize Yield](scenarios/maximize-yield.md)** - Combine borrowing + liquidity + rewards
    - **[Leverage Long Position](scenarios/leverage-long.md)** - Amplify exposure to an asset
    - **[Portfolio Rebalancing](scenarios/portfolio-rebalancing.md)** - Adjust your asset allocation

[→ View All Scenarios](index.md#complete-workflows)

---

## Common Issues

### "Wallet connection failed"

**Fix:**

- Unlock your wallet
- Refresh page
- Try different browser
- Disable conflicting extensions

### "Insufficient funds for transaction"

**Fix:**

- Get USDST for gas fees (see Step 4)
- Keep at least 10 USDST in wallet

### "Transaction failed"

**Fix:**

- Check you're on correct network (STRATO)
- Ensure sufficient USDST for gas
- Try increasing gas limit slightly
- Contact support if persists

### "Bridge taking too long"

**Normal:** Ethereum → STRATO bridges take 5-15 minutes

**If delayed:**

- Check Ethereum transaction confirmed
- Contact support with transaction hash
- Monitor bridge status in app

---

## Need Help?

- **Documentation**: Browse the [Guides](guides/borrow.md) and [FAQ](faq.md)
- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)

---

## Security Checklist

Before you start:

- [ ] Seed phrase backed up securely offline
- [ ] Never shared seed phrase or private key
- [ ] Bookmarked official STRATO URL
- [ ] Verified URL before connecting wallet
- [ ] Using hardware wallet for large amounts (recommended)
- [ ] Started with small test amount
- [ ] Understood liquidation risks
- [ ] Read safety best practices

**Ready?** → Choose your path above and start using STRATO DeFi!

