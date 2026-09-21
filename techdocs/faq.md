# Frequently Asked Questions

Common questions about STRATO.

---

## General

### What is STRATO?

STRATO is a Layer-1 blockchain for real-world-asset-backed DeFi. You can mint and borrow the USDST stablecoin against collateral, swap, provide liquidity, stake, and earn rewards. Mainnet is [app.strato.nexus](https://app.strato.nexus), and testnet is [app.testnet.strato.nexus](https://app.testnet.strato.nexus).

### How is STRATO different from Ethereum?

- **Smart contracts**: STRATO runs **SolidVM**, a Solidity dialect. It does not execute EVM bytecode. See [SolidVM](solidvm/index.md).
- **Ethereum-compatible interfaces**: the node accepts Ethereum-format signed transactions and serves Ethereum-style JSON-RPC, so standard wallets can sign for STRATO.
- **Consensus**: PBFT-style consensus with a stake-weighted proposer. Blocks are final once committed. See [Consensus & Staking](platform/consensus.md).
- **Fees**: a flat 0.01 USDST (or one voucher) per transaction, with no gas price.
- **Built-in indexing and sign-in**: contract state is indexed by Cirrus, and users can sign in with an OpenID Connect account whose key is held by Vault.

### What are the fees on STRATO?

- **Transaction fee**: 1 voucher if you have one, otherwise **0.01 USDST** per transaction. The fee is charged even if the transaction reverts. App actions that send several transactions (for example approve plus supply) pay once per transaction.
- **Protocol fees**: set on-chain per feature. Examples: swap fees (default 0.3% on standard pools), borrow interest, and CDP stability fees.
- **Source-chain gas**: bridging in from another chain costs that chain's gas.

### What are transaction vouchers?

Prepaid fee credits. One voucher pays one transaction fee in place of 0.01 USDST, and vouchers are used automatically first.

- The bridge service credits **25 vouchers** for each confirmed bridge deposit
- Vouchers cannot be transferred

---

## Getting Started

### How do I create an account?

Click **Connect Wallet** in the app, then either:

- choose **STRATO Wallet** to sign in, or create an account, on the STRATO sign-in page (your key is held by Vault), or
- connect a self-custody wallet

See the **[Quick Start Guide](quick-start.md)**.

### What wallet should I use?

The app's Connect Wallet dialog offers:

- **STRATO Wallet**: sign in with a STRATO account; no seed phrase
- **MetaMask**
- **Coinbase Wallet**
- **WalletConnect**-compatible wallets

### How do I bridge assets to STRATO?

1. Open **Fund** in the sidebar and choose **Bridge**
2. Pick the source network and asset
3. Enter the amount and confirm in your wallet (you pay source-chain gas)
4. The bridge service confirms the deposit and credits your STRATO address

To move assets out, use **Bridge Out**. Withdrawals are not instant and depend on available bridge liquidity. See the **[Bridge Guide](guides/bridge.md)**.

### Which chains and assets can I bridge?

Supported chains and assets are configured on-chain in the bridge contract, and the Fund page shows the current list. At the time of writing:

- **Mainnet**: Ethereum, Base, Linea, Robinhood Chain, and HyperEVM
- **Testnet**: Ethereum Sepolia, Base Sepolia, Robinhood Chain Testnet, and HyperEVM

Bridged assets include ETH, WBTC, wstETH, rETH, USDC, USDT, PAXG, and XAUt.

### Why do I need USDST?

Transaction fees are paid in USDST when you have no vouchers. USDST is also the stablecoin you mint, borrow, swap, and supply across the protocol.

---

## Borrowing

### How do I borrow on STRATO?

The app's **Borrow** page mints USDST against collateral held in **CDP vaults**, one vault per collateral asset. Minting has no lender on the other side: you pay a per-asset **stability fee** that accrues continuously. See **[Borrow USDST](guides/borrow.md)** and **[Mint USDST (CDP)](guides/mint-cdp.md)**.

STRATO also has a `LendingPool` contract, but the app does not currently offer lending-pool borrowing.

### What is Collateralization Ratio (CR)?

```
CR = (Collateral Value / Minted USDST) × 100%
```

Each collateral asset has a **liquidation ratio** (below it the vault can be liquidated) and a **minimum CR** that minting and withdrawals must respect. Both are set on-chain per asset.

### What is Health Factor?

```
Health Factor = CR / Liquidation Ratio
```

- **≥ 1.5**: shown normally in the vault list
- **1.0 - 1.5**: highlighted as a warning
- **< 1.0**: can be liquidated

**Example** (illustrative): 1 ETH at $3,000 with 1,500 USDST minted and a 150% liquidation ratio has CR 200% and a health factor of about 1.33.

### When will I be liquidated?

When a vault's CR falls below its asset's liquidation ratio, which is the same as its health factor falling below 1.0.

To avoid liquidation, keep a buffer, add collateral or repay debt when prices fall, and watch the liquidation alerts on the Portfolio page. See the **[Safety Guide](safety.md)**.

### How do I calculate my liquidation price?

For one vault:

```
Liquidation Price = (Minted USDST × Liquidation Ratio) / Collateral Amount
```

**Example** (illustrative): 1 ETH collateral, 1,500 USDST minted, 150% liquidation ratio gives (1,500 × 1.5) / 1 = $2,250.

### What happens during liquidation?

1. The vault's health factor drops below 1.0
2. Any user can repay part of the vault's debt, up to the asset's close factor (**Advanced → Liquidations** lists eligible vaults)
3. The liquidator receives collateral worth the repaid USDST plus the asset's liquidation penalty, at the oracle price
4. You keep the USDST you minted and lose the seized collateral

### Do my vaults protect each other?

No. Vaults are **isolated per asset**. Collateral in your ETH vault does not back debt in your WBTC vault, and each vault is liquidated on its own.

---

## Swaps & Liquidity

### What is impermanent loss?

The shortfall versus simply holding, caused by price divergence while your tokens are in a pool.

**Example** (standard constant-product pool, illustrative):

- Deposit 1 ETH ($3,000) + 3,000 USDST
- ETH doubles to $6,000
- Your pool share becomes ≈0.707 ETH + ≈4,243 USDST ≈ $8,485
- Holding would be worth $9,000
- **Impermanent loss ≈ $515**

Swap fees can offset this over time. See **[Core Concepts](concepts.md#impermanent-loss-liquidity-provision)**.

### How are swap fees calculated?

Standard pools charge a fee on the input amount. The default is **0.3%**: 70% of the fee stays in the pool for liquidity providers, and the rest goes to the protocol fee collector. Individual pools, stable pools, and V3 (concentrated-liquidity) pools can have different fee settings.

### How do I provide liquidity?

See the **[Liquidity Guide](guides/liquidity.md)**.

### What is slippage?

The difference between the quoted and executed trade price. It grows with trade size relative to pool depth, and with price movement before execution.

Your slippage tolerance sets a minimum output. If execution would fall below it, the transaction reverts (and still pays its fee).

---

## Rewards

### How do I earn Reward Points?

By taking part in activities configured in the Rewards contract. Examples are providing liquidity, supplying to lending, and one-time actions such as swaps. Each activity has its own emission rate.

See the **[Rewards Guide](guides/rewards.md)**.

### When are rewards distributed?

Rewards accrue continuously and can be claimed at any time from the **Rewards** page.

### What are Reward Points?

Reward Points are paid in the `CATA` token, a standard token on STRATO that you hold in your account after claiming.

---

## Developers

### What are the API and RPC endpoints?

| Interface | Mainnet | Testnet |
|---|---|---|
| **JSON-RPC** | `https://app.strato.nexus/rpc` or `https://noderpc.strato.nexus/rpc` | `https://app.testnet.strato.nexus/rpc` |
| **Core REST API** | `https://app.strato.nexus/strato-api/eth/v1.2` | `https://app.testnet.strato.nexus/strato-api/eth/v1.2` |
| **Cirrus (indexed data)** | `https://app.strato.nexus/cirrus/search` | `https://app.testnet.strato.nexus/cirrus/search` |
| **App API** | `https://app.strato.nexus/api` | `https://app.testnet.strato.nexus/api` |

Chain IDs: mainnet `123354377739506` (`0x7030addddcf2`), testnet `195049586845898` (`0xb165855668ca`).

See [JSON-RPC](reference/json-rpc.md), [Core Platform API](reference/strato-node-api.md), [Cirrus](reference/cirrus.md), and [API Overview](reference/api.md).

### Can I use Ethereum tools like MetaMask, ethers, or viem?

For signing and reading, yes. The node accepts Ethereum-format signed transactions (for example `eth_sendRawTransaction`) and serves standard JSON-RPC methods such as `eth_chainId`, `eth_call`, `eth_getBalance`, and `eth_getLogs`.

Contracts, however, run on **SolidVM**, not the EVM, so EVM bytecode is not executed. See [SolidVM](solidvm/index.md) and [Transactions & Fees](platform/transactions-and-fees.md).

### How do I write smart contracts for STRATO?

In SolidVM's Solidity dialect. Start with [SolidVM](solidvm/index.md).

### How do I query contract state and events?

Use **Cirrus**, which indexes contract state and events and serves them read-only at `/cirrus/search`. See [Cirrus](reference/cirrus.md).

### Where can I find smart contract addresses?

See **[Contract Addresses](build-apps/contract-addresses.md)**.

### How do I integrate STRATO into my app?

See the **[Developer Integration Guide](build-apps/integration.md)** and the **[API Reference](reference/api.md)**.

---

## Node Operators

### Can I run my own STRATO node?

Yes. Nodes are built from source and started with `strato-up`. Mainnet (upquark) is the default, and `--network=helium` joins testnet. See **[Run a Node](node/index.md)**.

### What hardware do I need?

We recommend 4 vCPU, 16 GB RAM, and 100 GB+ of SSD storage. Validators are not supported below 8 GB RAM. See [Requirements](node/requirements.md).

### How do I sync quickly?

Start the node with `--snapshot` to restore a recent snapshot instead of replaying the chain from genesis. See [Operations](node/operations.md).

### How do I become a validator?

Register as an operator, bond at least the on-chain minimum stake (self-bond plus delegations), then activate to join the validator set. The **Stake** page in the app walks through these steps. Stake-weighted consensus is active on testnet. On mainnet it activates at block 1,000,000; see [Fork heights](platform/networks.md#fork-heights). Your validator address is your node's consensus key.

See [Consensus & Staking](platform/consensus.md).

---

## Troubleshooting

### Transaction failed - what do I do?

1. **No voucher and less than 0.01 USDST**: the fee can't be paid, so the transaction is rejected. Get USDST or bridge in.
2. **Contract revert** (for example, slippage or a health-factor check): read the error, adjust, and retry. Reverted transactions still pay their fee.
3. **Wrong network** (external wallets): switch your wallet to the STRATO network.
4. **Nonce mismatch**: wait for pending transactions to confirm, then retry.

### My balance isn't showing

- Refresh the page and wait a few seconds for indexing
- Check that you are on the right network (mainnet or testnet)
- Check that you are connected with the same account or wallet you used before
- Look up the transaction on the explorer ([stratoscan.strato.nexus](https://stratoscan.strato.nexus))

### Wallet won't connect

- Unlock your wallet and refresh the page
- Disable conflicting browser extensions or try another browser
- For the STRATO Wallet option, complete the sign-in page so it returns you to the app

### Bridge is taking too long

- Confirm the source-chain transaction is confirmed
- Check the transaction status on the **Fund** page
- Contact support with the source-chain transaction hash

Withdrawals (**Bridge Out**) are not instant and depend on available bridge liquidity.

### How do I contact support?

- **Documentation**: [docs.strato.nexus](https://docs.strato.nexus)
- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)

---

## Safety & Security

### How do I keep my assets safe?

See the **[Safety & Best Practices](safety.md)** guide.

- Never share a seed phrase, private key, or password
- Verify the app URL before signing in or connecting
- Use a hardware wallet for large amounts with an external wallet
- Start with small test amounts
- Keep a buffer on your health factor or CR

### What if I lose my seed phrase or password?

- **External wallet (MetaMask, etc.)**: your seed phrase is the only way to recover the wallet. Without it, funds in that wallet cannot be recovered.
- **STRATO account**: there is no seed phrase. Your key is held by Vault and tied to your sign-in account, so contact [support](https://support.blockapps.net) if you lose access.

### Can transactions be reversed?

No. Committed transactions are final. Always double-check addresses and amounts, and start with small test amounts.

---

## Still have questions?

- **Browse Guides**: [Borrow](guides/borrow.md) | [Mint CDP](guides/mint-cdp.md) | [Swap](guides/swap.md) | [Liquidity](guides/liquidity.md)
- **Read Core Concepts**: [Core Concepts Guide](concepts.md)
- **Get Support**: [support.blockapps.net](https://support.blockapps.net)
- **Join Community**: [t.me/strato_net](https://t.me/strato_net)
