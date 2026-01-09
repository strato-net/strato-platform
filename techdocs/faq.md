# Frequently Asked Questions

Common questions about STRATO DeFi.

---

## General

### What is STRATO?

STRATO is a blockchain platform for decentralized finance (DeFi) that enables borrowing, swapping, liquidity provision, and earning rewards with lower fees and faster transactions than Ethereum mainnet.

### How is STRATO different from Ethereum?

- **Faster**: 1-2 second transaction finality vs. 12+ seconds on Ethereum
- **Cheaper**: Transactions typically < $0.10 vs. $5-50+ on Ethereum
- **Compatible**: Full Solidity/EVM compatibility - same tools and contracts work
- **Enterprise-ready**: OAuth support, permissioned options, HSM integration

### What are the fees on STRATO?

- **Transaction fees**: 
  - First 10 transactions: **FREE** (using vouchers from bridge-in)
  - After vouchers: 0.01 USDST (~$0.01) per transaction
- **Bridge fees**: Ethereum gas fees when bridging (varies by network congestion)
- **Protocol fees**: Small percentage on swaps, borrows, etc. (goes to protocol treasury)

### What are transaction vouchers?

Transaction vouchers are free transaction fee credits automatically given when you bridge assets to STRATO.

**Key details:**
- **10 vouchers** per bridge-in (every time)
- Each voucher covers **1 transaction fee**
- Used automatically (no action needed)
- After vouchers run out: 0.01 USDST per transaction

**How to get more:**
- Bridge assets again (any amount, any time)
- Each bridge-in gives you 10 more vouchers

**Example:**
```
Bridge 0.5 ETH → Get 10 vouchers → 10 free transactions
Bridge 100 USDC → Get 10 more vouchers → 10 more free transactions
```

### Testnet vs Mainnet - which should I use?

- **Testnet (Helium)**: For learning and testing. Free test tokens, no real value at risk. Start here if you're new.
- **Mainnet (Upquark)**: For real DeFi operations with actual value. Use after you're comfortable with testnet.

### How do I get test tokens on testnet?

1. Switch to STRATO Testnet in your wallet
2. Go to the Faucet page in the app
3. Request test tokens (ETH, USDC, etc.)
4. Start experimenting!

---

## Getting Started

### How do I create an account?

See the **[Quick Start Guide](quick-start.md)** for step-by-step instructions. You can sign up with email or connect with your Web3 wallet (MetaMask, etc.).

### What wallet should I use?

**Recommended**: MetaMask (most popular and tested)

**Also supported**:

- WalletConnect-compatible wallets
- Coinbase Wallet
- Trust Wallet

### How do I add STRATO to my wallet?

The app will auto-prompt you to add the network. Or add manually:

- **RPC URL**: `https://app.strato.nexus/strato-api/eth/v1.2`
- **Chain ID**: (auto-detected)
- **Currency Symbol**: ETH

See **[Quick Start Guide](quick-start.md#step-2-set-up-your-wallet)** for full details.

### How do I bridge assets to STRATO?

1. Go to **Deposits** (sidebar) → **Bridge In** tab (for deposits) OR **Withdrawals** (sidebar) for withdrawals
2. Connect wallet to Ethereum network
3. Select asset and amount
4. Approve and confirm (requires ETH for gas)
5. Wait 5-15 minutes for bridge completion

See **[Bridge Guide](guides/bridge.md)** for detailed instructions.

### Why do I need USDST?

USDST is STRATO's native token used for:

- **Gas fees**: All transactions require small USDST for fees (< $0.10 typically)
- **Stable value**: USD-pegged stablecoin for stable collateral and trading
- **DeFi operations**: Can be borrowed, minted, swapped, or used as collateral

---

## Borrowing & Lending

### What's the difference between Borrowing (Lending Pool) and CDP?

| Feature | Lending Pool | CDP |
|---------|-------------|-----|
| **Action** | Borrow USDST | Mint USDST |
| **Source** | Borrowed from pool | Created from nothing |
| **Interest** | Variable borrow rate | Fixed stability fee (typically lower) |
| **Best for** | Short-term, flexible | Long-term, capital efficient |
| **Collateral** | Stored in CollateralVault | Stored in CDPVault |

**Important:** Lending and CDP use **separate collateral vaults**. You cannot use the same collateral for both systems simultaneously.

See **[Core Concepts](concepts.md)** for detailed comparison.

### What is Health Factor?

Health Factor shows how safe your lending position is:

```
Health Factor = (Collateral Value × Liquidation Threshold) / Borrowed Amount
```

- **> 2.0**: Very safe (recommended)
- **1.5 - 2.0**: Safe with buffer
- **1.0 - 1.5**: Moderate risk
- **< 1.0**: LIQUIDATION occurs

**Example**: You deposit $10,000 ETH (80% liquidation threshold), borrow $5,000 USDST
- Health Factor = ($10,000 × 0.8) / $5,000 = 1.6
- Safe, but watch ETHST price

### What is Collateralization Ratio (CDP)?

CR is the CDP equivalent of Health Factor:

```
CR = (Collateral Value / Minted USDST) × 100%
```

- **200%+**: Very safe
- **150-200%**: Moderate risk
- **< 150%**: Often liquidated (varies by asset)

### When will I be liquidated?

**Lending Pool**: When Health Factor < 1.0

**CDP**: When CR < Liquidation Ratio (e.g., < 150% for ETH)

To avoid liquidation:

- Maintain high health factor (2.0+) or CR (200%+)
- Add more collateral if prices drop
- Repay/burn some debt
- Set price alerts

See **[Safety Guide](safety.md)** for risk management strategies.

### How do I calculate my liquidation price?

**For a lending position:**

```
Liquidation Price = (Borrowed Amount) / (Collateral Amount × Liquidation Threshold)
```

**Example**: 1 ETH collateral, $2,400 borrowed, 80% liquidation threshold
- Liquidation Price = $2,400 / (1 × 0.8) = $3,000
- If ETHST drops to $3,000, you'll be liquidated

**Use the app's calculator** for accurate real-time calculations with multiple assets.

### What happens during liquidation?

1. Your Health Factor drops < 1.0 (or CR < minimum)
2. A liquidator repays part/all of your debt
3. Liquidator takes your collateral + bonus (5-10%)
4. You keep the borrowed/minted USDST
5. Net result: You lose collateral value beyond your debt

**Always monitor positions and add collateral before liquidation occurs!**

### If I have a 1.07 Health Factor in Lending, what's my CDP ratio?

**These are independent systems** with separate collateral vaults.

If you have:

- Lending HF = 1.07 with 10 ETH in CollateralVault
- This tells you nothing about your CDP position

Your CDP ratio depends on:

- How much collateral you deposited into **CDPVault** (separate deposit)
- How much USDST you minted from CDP

**Example comparing equivalent positions:**

- **Lending**: 10 ETHST deposited → Borrow $18,750 → HF = 1.07
- **CDP equivalent**: 10 ETHST deposited → Mint $18,750 → CR = 160%

But these would require **separate 10 ETHST deposits** (20 ETHST total) since the vaults are separate.

---

## Swaps & Liquidity

### What is impermanent loss?

Impermanent loss occurs when you provide liquidity and token prices diverge from when you deposited.

**Example**:

- Deposit 1 ETHST ($3,000) + 3,000 USDCST
- ETH doubles to $6,000
- Pool auto-rebalances: you now have 0.707 ETH + 4,242 USDC
- Pool value: $8,485
- If you just held: $9,000
- **Impermanent loss: $515**

**But**: Trading fees may offset this loss over time.

See **[Core Concepts](concepts.md#impermanent-loss-liquidity-provision)** for details.

### How are swap fees calculated?

- **Trading fee**: Small percentage (typically 0.3%) on swap amount
- **Goes to**: Liquidity providers (you if you provide liquidity)
- **Protocol fee**: Small portion to STRATO treasury

### How do I provide liquidity?

See **[Liquidity Guide](guides/liquidity.md)** for step-by-step instructions.

### What is slippage?

Slippage is the difference between expected and actual trade price.

**Causes**:

- Pool size too small for your trade
- Price moves during execution
- Network congestion

**Settings**:

- **Low (0.1-0.5%)**: Safer, may fail in volatile markets
- **High (1-5%)**: More tolerant, risk of worse price

---

## Rewards

### How do I earn Reward Points?

Earn Reward Points by:

- Supplying collateral to lending pool
- Borrowing USDST
- Providing liquidity to swap pools
- Minting USDST via CDP
- Completing swaps

See **[Rewards Guide](guides/rewards.md)** for details.

### When are rewards distributed?

Rewards accrue continuously and can be claimed at any time. Check the **Rewards** section in the app to see your pending rewards.

### What can I do with Reward Points?

- **Trade**: Swap for other tokens
- **Hold**: Store value
- **Governance**: Vote on protocol changes (coming soon)
- **Earn more**: Provide Reward Point liquidity

---

## Technical

### What are the RPC endpoints?

**Mainnet**:
```
https://app.strato.nexus/strato-api/eth/v1.2
```

**Testnet**:
```
https://buildtest.mercata-testnet.blockapps.net/strato-api/eth/v1.2
```

### Where can I find smart contract addresses?

Check the **[Available Tokens](concepts.md#available-tokens)** section or view in the app's settings/info section.

### How do I integrate STRATO into my app?

See the **[Developer Integration Guide](build-apps/integration.md)** for:

- Authentication setup
- API documentation
- Code examples
- Smart contract integration

### Is there an API?

Yes! See **[API Reference](reference/api.md)** for full documentation.

### Can I run my own STRATO node?

Yes, for enterprise deployments. Contact the STRATO team for:

- Node setup instructions
- Validator participation
- Private network deployment
- Custom configurations

---

## Troubleshooting

### Transaction failed - what do I do?

**Common causes and fixes**:

1. **Insufficient USDST for gas**
   - Get more USDST for fees
   - Keep 10-20 USDST in wallet

2. **Wrong network**
   - Switch to STRATO network in wallet
   - Verify RPC endpoint is correct

3. **Slippage too low**
   - Increase slippage tolerance
   - Try again during less volatile period

4. **Nonce error**
   - Reset account in wallet settings
   - Clear pending transactions

### My balance isn't showing

**Fixes**:

- Refresh page
- Verify correct network selected
- Check if transaction confirmed on block explorer
- Wait a few seconds for indexing
- Try disconnecting and reconnecting wallet

### Wallet won't connect

**Fixes**:

- Unlock wallet
- Disable conflicting browser extensions
- Try different browser
- Clear browser cache
- Update wallet extension

### Bridge is taking too long

**Normal**: 5-15 minutes for Ethereum → STRATO

**If delayed (> 30 min)**:

- Check Ethereum transaction confirmed
- Verify sufficient gas was paid
- Contact support with transaction hash
- Monitor bridge status page

### How do I contact support?

- **Documentation**: [docs.strato.nexus](https://docs.strato.nexus)
- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)

---

## Safety & Security

### How do I keep my assets safe?

See the complete **[Safety & Best Practices](safety.md)** guide.

**Key points**:

- Never share seed phrase or private keys
- Use hardware wallet for large amounts
- Verify URLs before connecting
- Start with small test amounts
- Maintain high health factor/CR
- Set price alerts

### What if I lose my seed phrase?

**If using wallet-based signup**: Your seed phrase is your ONLY way to recover funds. Without it, funds are permanently lost. This is a fundamental property of blockchain - no one can recover your wallet.

**If using email/password**: You can reset your password, but you still need your wallet seed phrase to access on-chain assets.

**Prevention**: Write seed phrase on paper, store in multiple secure locations (fireproof safe, safety deposit box, etc.).


### Can transactions be reversed?

No. Blockchain transactions are permanent and cannot be reversed. Always:

- Double-check addresses
- Verify transaction details
- Start with small test amounts
- Review before confirming

---

## Still have questions?

- **Browse Guides**: [Borrow](guides/borrow.md) | [Mint CDP](guides/mint-cdp.md) | [Swap](guides/swap.md) | [Liquidity](guides/liquidity.md)
- **Read Core Concepts**: [Core Concepts Guide](concepts.md)
- **Get Support**: [support.blockapps.net](https://support.blockapps.net)
- **Join Community**: [t.me/strato_net](https://t.me/strato_net)

