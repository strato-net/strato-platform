# STRATO Technical Documentation

STRATO is a Layer-1 blockchain for real-world-asset-backed DeFi. Users mint and borrow the USDST stablecoin against collateral (tokenized gold and silver, bridged crypto), swap, provide liquidity, stake, and earn rewards. The chain runs **SolidVM** smart contracts under **PBFT consensus** with a stake-weighted proposer, and every transaction costs a flat **0.01 USDST** (or one voucher).

- **Mainnet (upquark):** [app.strato.nexus](https://app.strato.nexus)
- **Testnet (helium):** [app.testnet.strato.nexus](https://app.testnet.strato.nexus)

---

## 🚀 Quick Start

!!! tip "New to STRATO?"
    Connect a wallet, fund your account, and make your first transaction.

    **[→ Quick Start Guide](quick-start.md)**

!!! example "Building on STRATO?"
    Integrate with the app API, the node APIs, and the platform contracts.

    **[→ Developer Quick Start](build-apps/quickstart.md)**

!!! info "Running a node?"
    Build STRATO from source and join mainnet or testnet.

    **[→ Run a Node](node/index.md)**

---

## 📚 For End Users

### Complete Workflows

**End-to-end scenarios** combining multiple features:

- **[First-Time User](scenarios/first-time-user.md)** - Onboarding from funding to first borrow
- **[Grow Your Position](scenarios/grow-position.md)** - Build on an existing position
- **[Maximize Yield](scenarios/maximize-yield.md)** - Combine lending, liquidity, and rewards
- **[DCA Strategy](scenarios/dca-strategy.md)** - Dollar-cost average into DeFi positions
- **[Platform Migration](scenarios/platform-migration.md)** - Move from Aave/Compound/MakerDAO
- **[Portfolio Rebalancing](scenarios/portfolio-rebalancing.md)** - Diversify without closing positions
- **[Risk Management](scenarios/risk-hedging.md)** - Hedge against volatility
- **[Leverage Long](scenarios/leverage-long.md)** - Leveraged exposure (advanced, high risk)
- **[Multi-Asset Strategy](scenarios/multi-asset-strategy.md)** - Multi-collateral positions
- **[Collateral Optimization](scenarios/collateral-optimization.md)** - Dynamic rebalancing
- **[Arbitrage & Market Making](scenarios/arbitrage-market-making.md)** - Active trading
- **[Withdrawals](scenarios/withdrawals.md)** - Move assets off STRATO

### Feature Guides

**Step-by-step guides** for individual features:

- **[Borrow USDST](guides/borrow.md)** - Borrow against collateral
- **[Mint USDST (CDP)](guides/mint-cdp.md)** - Mint USDST against collateral
- **[Swap Tokens](guides/swap.md)** - Trade on the DEX
- **[Provide Liquidity](guides/liquidity.md)** - Earn trading fees
- **[Bridge Assets](guides/bridge.md)** - Move assets between STRATO and other chains
- **[Manage Rewards](guides/rewards.md)** - Earn and claim Reward Points

### Essential Knowledge

- **[Core Concepts](concepts.md)** - Fees, vouchers, wallets, health factor, CR, liquidation
- **[Safety & Risk](safety.md)** - Protect your assets
- **[Tokenomics](tokenomics.md)** - The $STRATO token
- **[FAQ](faq.md)** - Common questions answered

---

## 👨‍💻 For App Builders

### Getting Started

- **[Developer Quick Start](build-apps/quickstart.md)** - First transaction
- **[Platform Overview](build-apps/overview.md)** - Platform overview & setup
- **[Quick Reference](build-apps/quick-reference.md)** - Common operations
- **[Contract Addresses](build-apps/contract-addresses.md)** - Deployed contracts

### Integration Guides

- **[API Integration](build-apps/integration.md)** - Tutorial with authentication
- **[E2E Examples](build-apps/e2e.md)** - Yield farming, dashboards, bots

### Smart Contracts

- **[SolidVM](solidvm/index.md)** - STRATO's contract language and VM (SolidVM only; no EVM bytecode execution)

---

## 🧱 Platform

How the chain itself works:

- **[Networks](platform/networks.md)** - Mainnet (upquark) and testnet (helium), chain IDs, domains
- **[Consensus & Staking](platform/consensus.md)** - PBFT, validators, stake-weighted proposer selection, block rewards
- **[Identity & Vault](platform/identity-and-vault.md)** - OIDC sign-in, custodial keys in Vault, self-custody wallets
- **[Transactions & Fees](platform/transactions-and-fees.md)** - Transaction types, signing paths, fees and vouchers, simulation

---

## 📖 API Reference

- **[API Overview](reference/api.md)** - Authentication and common patterns
- **[Interactive API (Swagger)](reference/interactive-api.md)** - Explore the app API
- **[Core Platform API](reference/strato-node-api.md)** - Blocks, accounts, transactions (`/strato-api/eth/v1.2`)
- **[Cirrus](reference/cirrus.md)** - Indexed contract state and events (`/cirrus/search`)
- **[JSON-RPC](reference/json-rpc.md)** - Ethereum-style JSON-RPC (`/rpc`)
- **[System Architecture](reference/architecture.md)** - Platform design and components

---

## 🖥️ For Node Operators

- **[Run a Node](node/index.md)** - Overview
- **[Requirements](node/requirements.md)** - Hardware, OS, ports
- **[Install](node/install.md)** - Build from source, `strato-login`, `strato-up`
- **[Configuration](node/configuration.md)** - Flags and `ethconf.yaml`
- **[Operations](node/operations.md)** - Status, logs, snapshots, upgrades, troubleshooting

---

## 🛠️ For Contributors

- **[Setup](contribute/setup.md)** - Development environment
- **[Architecture](contribute/architecture.md)** - STRATO components
- **[Contributing Guidelines](contribute/contributing.md)** - How to contribute
- **[Release Notes](release-notes.md)** - What changed in each version

---

## 🎯 Popular Paths

!!! question "I want to..."

    **Get started from scratch**
    → [First-Time User Guide](scenarios/first-time-user.md)

    **Earn yield**
    → [Maximize Yield Scenario](scenarios/maximize-yield.md)

    **Build an application**
    → [Developer Quick Start](build-apps/quickstart.md)

    **Run a node or become a validator**
    → [Run a Node](node/index.md) · [Consensus & Staking](platform/consensus.md)

    **Understand the basics**
    → [Core Concepts](concepts.md)

---

## ❓ Need Help?

!!! info "We're here to help!"
    - **Documentation**: [docs.strato.nexus](https://docs.strato.nexus)
    - **Support**: [support.blockapps.net](https://support.blockapps.net)
    - **Telegram**: [t.me/strato_net](https://t.me/strato_net)
    - **Source code**: [github.com/strato-net/strato-platform](https://github.com/strato-net/strato-platform)
