# Quick Start Guide

Get started with STRATO DeFi: connect, fund your account, and make your first transaction.

## What You'll Need

- A browser
- **Either** a STRATO account (you can create one at sign-in) **or** a browser wallet such as MetaMask, Coinbase Wallet, or a WalletConnect-compatible wallet
- Assets on a supported chain to bridge in

!!! tip "New to DeFi?"
    Read **[Core Concepts](concepts.md)** first to understand collateral, health factor, and liquidation.

!!! note "Mainnet and testnet"
    - **Mainnet**: real assets - [app.strato.nexus](https://app.strato.nexus)
    - **Testnet**: practice network - [app.testnet.strato.nexus](https://app.testnet.strato.nexus)

    See [Networks](platform/networks.md) for chain IDs and endpoints.

---

## Step 1: Connect

Open the app and click **Connect Wallet**. The dialog offers two kinds of account:

=== "STRATO Wallet (STRATO account)"

    1. Choose **STRATO Wallet**.
    2. You are redirected to the STRATO sign-in page (OpenID Connect). Sign in, or create an account if you don't have one.
    3. You return to the app signed in.

    Your signing key is created and held for you by the STRATO Vault on your first authenticated request. There is no seed phrase to manage, and the app signs transactions for you.

=== "External wallet (self-custody)"

    1. Choose **MetaMask**, **Coinbase Wallet**, or **WalletConnect**.
    2. Approve the connection in your wallet.
    3. When you submit an action, the app builds the transaction and your wallet asks you to sign it.

    You hold your own keys. Back up your seed phrase offline and never share it.

See [Identity & Vault](platform/identity-and-vault.md) for how the two models work.

---

## Step 2: Fund Your Account

Open **Fund** in the sidebar. It has two modes.

### Bridge

Deposit tokens from another chain:

1. Select **Bridge**.
2. Pick the source network and asset.
3. Enter the amount and confirm the deposit in your wallet (you pay the source chain's gas).
4. The bridge service confirms the deposit and credits the tokens to your STRATO address.

Supported networks and assets are configured on-chain in the bridge contract, and the Fund page always shows the current list. At the time of writing, mainnet bridges from **Ethereum, Base, Linea, Robinhood Chain, and HyperEVM**. Assets include ETH, WBTC, wstETH, rETH, USDC, USDT, PAXG, and XAUt.

!!! success "Transaction vouchers"
    Each confirmed bridge deposit credits your account with **25 transaction vouchers**. A voucher pays one transaction fee in place of 0.01 USDST, and vouchers are used first. Vouchers cannot be transferred.

!!! info "Bridged tokens"
    Bridged tokens are STRATO-side tokens, named after the source asset (for example "STRATO ETH", symbol `ETH`). Use them for swaps, lending, collateral, and pools, and bridge them back out with **Bridge Out**. Learn more: **[Bridged Tokens](concepts.md#bridged-tokens)**

### Metals

Select **Metals** to buy **GOLDST** or **SILVST** (tokenized gold and silver), paying with one of the supported tokens listed on the page.

---

## Step 3: Keep USDST for Fees

Every STRATO transaction pays a flat fee of **0.01 USDST** (or one voucher). There is no gas price to set.

Some app actions send more than one transaction. For example, approve plus supply costs 0.02 USDST.

Ways to get USDST:

- **Swap** a bridged stablecoin or other token for USDST
- **Borrow** USDST against collateral ([Borrow guide](guides/borrow.md))
- **Mint** USDST in a CDP ([Mint guide](guides/mint-cdp.md))

---

## Step 4: Start Small

Before committing large amounts:

1. Start with a small amount
2. Try a simple swap
3. Confirm the transaction succeeds and your balances update
4. Then proceed with larger operations

---

## What's Next?

!!! tip "First Time User"
    **[→ Complete First-Time User Guide](scenarios/first-time-user.md)** - Full walkthrough to your first DeFi transaction.

- **[Core Concepts](concepts.md)** - Collateral, health factor, and liquidation
- **[Safety Practices](safety.md)** - Security and risk management

!!! example "Core DeFi Features"
    - **[Borrow USDST](guides/borrow.md)** - Borrow against your collateral
    - **[Mint USDST via CDP](guides/mint-cdp.md)** - Mint USDST against collateral
    - **[Swap Tokens](guides/swap.md)** - Exchange assets
    - **[Provide Liquidity](guides/liquidity.md)** - Earn fees as a liquidity provider
    - **[Bridge Assets](guides/bridge.md)** - Move assets cross-chain
    - **[Earn Rewards](guides/rewards.md)** - Earn and claim Reward Points

[→ View All Scenarios](index.md#complete-workflows)

---

## Common Issues

### "Wallet connection failed"

- Unlock your wallet and refresh the page
- Disable conflicting wallet extensions or try another browser
- For the STRATO Wallet option, make sure the sign-in page completed and returned you to the app

### "Insufficient funds" when submitting

The fee is charged before the transaction runs. If you have no voucher and less than 0.01 USDST, the transaction is rejected.

- Get USDST (see Step 3) or bridge in to receive vouchers

### "Transaction failed"

- Read the error message: most failures come from the contract (for example, slippage or a health-factor check)
- A transaction that reverts **still pays its fee**
- With an external wallet, make sure the wallet is on the STRATO network when signing
- Contact support with the transaction hash if the problem persists

### "My deposit hasn't arrived"

- Check that the source-chain transaction is confirmed
- Check the transaction under **Fund** (recent transactions)
- Contact support with the source-chain transaction hash

Withdrawals (**Bridge Out**) are not instant and depend on available bridge liquidity.

---

## Need Help?

- **Documentation**: [Guides](guides/borrow.md) and [FAQ](faq.md)
- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)

---

## Security Checklist

- [ ] Bookmarked the official app URL and verify it before signing in or connecting
- [ ] External wallet: seed phrase backed up offline and never shared
- [ ] Hardware wallet for large amounts (external wallets)
- [ ] Started with a small test amount
- [ ] Understood liquidation risks ([Safety guide](safety.md))
