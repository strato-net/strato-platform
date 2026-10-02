# Migrating from Other DeFi Platforms

Move a position from another DeFi platform to STRATO.

!!! note "Compare on current data"
    This page describes how STRATO works. It does not quote other platforms' rates or costs. Before migrating, compare live figures: the STRATO app shows each vault's stability fee and each earn product's APY.

---

## How Familiar Concepts Map to STRATO

| If you use... | On STRATO | Where |
|---------------|-----------|-------|
| Over-collateralized stablecoin minting (Maker/Sky-style vaults) | CDP vaults that mint USDST | **Borrow** |
| Borrowing from a lending pool (Aave/Compound-style) | The app's Borrow page uses CDP vaults: you mint USDST against collateral instead of borrowing from suppliers | **Borrow** |
| AMM swaps | Constant-product pools, stablecoin pools, concentrated-liquidity (V3) pools | **Trade**, **Advanced → Swap Pools**, **V3 Liquidity** |
| Savings-rate tokens | USDST Savings Vault (saveUSDST) | **Earn** |
| Stablecoin swap facility (PSM) | Direct Mint PSM: USDC/USDT to USDST and back | **Advanced → PSM** |
| Liquidity mining | Reward Points | **Rewards** |
| Gas paid in a native token | Flat 0.01 USDST per transaction, or one voucher | Automatic |

## Differences to Plan For

- **Fees:** Every STRATO transaction costs 0.01 USDST or one voucher, whatever its complexity. Bridge deposits also pay gas on the source network. See [Transactions and Fees](../platform/transactions-and-fees.md).
- **Health metrics differ:** CDP health factor = collateralization ratio / liquidation ratio, set per asset. Don't copy a health factor from another platform; recalculate for STRATO's parameters.
- **Vaults are isolated:** Each collateral asset has its own vault and is liquidated independently.
- **Exits are not instant:** Bridge-out requests are reviewed by bridge operators. The app says they are processed within 1-3 business days. See [Withdrawals](withdrawals.md).
- **Asset coverage:** Only assets with a bridge route can come in, and only listed collateral can back USDST. Check the **Fund** and **Borrow** pages.

---

## Migration Steps

### 1. Check Support

- On **Fund → Bridge In**, confirm your network and asset are listed. On mainnet the bridge currently covers Ethereum, Base, Linea, HyperEVM and Robinhood Chain.
- On **Borrow**, confirm the asset is eligible collateral and note its stability fee.

### 2. Close or Reduce the Old Position

Follow the other platform's own documentation to repay debt and withdraw collateral. Account for that network's gas and any price movement while you are between platforms.

### 3. Bridge In

On **Fund → Bridge In**, deposit the assets. Stablecoins can arrive as USDST directly. Your first confirmed deposit also mints vouchers for fees. Walkthrough: [First-Time User Journey](first-time-user.md).

### 4. Recreate the Position

1. On **Borrow**, enter a **Mint Amount** and set the risk slider to your target health factor.
2. Check **Projected Vault Health**, then click **Mint**.
3. If you need USDC or USDT rather than USDST, redeem on **Advanced → PSM** (subject to available liquidity) or swap on **Trade**.

See the [Mint USDST (CDP) Guide](../guides/mint-cdp.md).

### 5. Monitor

- **Borrow → Your Vaults** shows each vault's health factor and debt.
- The **Portfolio** page shows a warning banner when a vault is at risk.

---

## Lower-Risk Option: Migrate in Parts

1. Bridge a small amount and open a small position to learn the flow.
2. Move the rest in batches once you're comfortable.

You pay costs on both platforms for a while, but you are never fully out of a position.

---

## Checklist

- [ ] Assets and networks supported on Fund; collateral eligible on Borrow
- [ ] Old position's full debt, including accrued interest, known
- [ ] Source-network gas budgeted
- [ ] External wallet ready to connect for bridging
- [ ] Target health factor chosen for STRATO's parameters
- [ ] Rewards on the old platform claimed

## Going Back

There is no lock-in: repay, withdraw and bridge out whenever you like. Bridge-outs are reviewed and not instant. See [Withdrawals](withdrawals.md).

---

## Related

- [Maximize Yield](maximize-yield.md)
- [Liquidity Guide](../guides/liquidity.md)
- [Rewards Guide](../guides/rewards.md)
- [Swap Guide](../guides/swap.md)

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
