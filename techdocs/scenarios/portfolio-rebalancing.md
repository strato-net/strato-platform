# Portfolio Rebalancing

Shift your exposure between assets while keeping a USDST position open.

!!! info "How this maps to the app"
    In the current app, **Borrow** (sidebar, TRADE section) opens USDST vaults (CDP). Each collateral asset has its **own vault** with its own collateral, debt and health factor. Debt can't be moved between vaults, so rebalancing collateral means repaying in one vault and minting in another. See [Mint USDST via CDP](../guides/mint-cdp.md) for the basics.

---

## What You'll Use

| Task | Where in the app |
|------|------------------|
| See each vault's collateral, debt, Health Factor and stability fee | **Borrow** → your vaults |
| Deposit, withdraw, mint or repay on one vault | **Borrow** → vault actions |
| Swap between assets | **Trade** |
| Buy GOLDST or SILVST at the oracle price | **Fund** → **Buy Metals** |

**Costs:** every transaction costs 0.01 USDST, or one voucher if you hold one, even if it reverts. An action that needs an approval plus the action itself costs 0.02 USDST. Swaps also pay the pool's swap fee and any price impact. See [Transactions & Fees](../platform/transactions-and-fees.md).

---

## Rules That Decide the Order of Steps

These come from the `CDPEngine` contract. Parameter values differ per asset and can change, so read them in the app rather than relying on fixed numbers.

- **Collateralization ratio (CR)** = collateral value at the oracle price ÷ debt (debt includes the accrued stability fee).
- **Withdraw** while the vault has debt only if CR stays at or above the asset's **minimum CR**. **Withdraw Max** computes the largest such amount.
- **Mint** only while `current debt + new mint < collateral value ÷ minimum CR`, and within the asset's system-wide **debt ceiling**.
- **Debt floor:** a vault's debt must be zero or at least the asset's debt floor. A partial repay that would leave less than the floor reverts; use **Repay All** instead.
- **Liquidation** is per vault, when CR falls below the asset's **liquidation ratio**. The app shows **Health Factor = CR ÷ liquidation ratio**; below 1.0 the vault can be liquidated.

---

## Case 1: Rebalance Assets in Your Wallet

If the assets aren't locked in vaults, rebalancing is just trading.

1. Go to **Trade**, choose the two tokens and enter an amount.
2. The app quotes every pool that holds the pair (constant-product, stable, and each V3 fee tier) and auto-selects the best rate. Open the pool selector to pick a pool yourself.
3. Check the price impact and slippage setting, then confirm.

For precious-metal exposure, **Fund** → **Buy Metals** mints GOLDST or SILVST through the `MetalForge` contract. You pay with a supported token and receive metal at the oracle price, less the mint fee shown in the app, up to a per-metal mint cap. MetalForge only mints. To sell metal tokens, swap them on **Trade**.

---

## Case 2: Rebalance Vault Collateral With Debt Outstanding

**Goal:** reduce collateral in vault A (asset A) and build collateral in vault B (asset B) without closing your USDST position.

Work in small rounds so no vault's Health Factor drops below your own safety threshold:

1. **Review.** On **Borrow**, note each vault's collateral, debt and Health Factor. Confirm asset B is offered as vault collateral and has pool liquidity on **Trade**.
2. **Repay part of vault A** with USDST from your wallet. Lower debt frees collateral under the minimum-CR rule. Mind the debt floor.
3. **Withdraw the freed collateral** from vault A, or use **Withdraw Max**.
4. **Swap A → B** on **Trade**.
5. **Deposit B into vault B**. If you want your USDST back, **Mint USDST** from vault B. Vault B's debt must meet its debt floor.
6. **Repeat** steps 2–5 with the newly minted USDST until you reach your target mix.

If you have no spare USDST, start with a small **Withdraw** from vault A that keeps its Health Factor well above your threshold, then continue from step 4.

!!! tip "The Borrow page planner"
    The Mint form can split a new mint across several vaults, including deposits from your wallet. In auto mode it prefers vaults with lower stability fees, then vaults that already hold collateral, then vaults with more headroom, while keeping the target Health Factor you set with the slider. Switch off auto-allocation to set each vault's deposit and mint yourself. The planner adds collateral and debt only; it doesn't move existing debt between vaults.

---

## After Rebalancing

- **Check every vault's Health Factor**, not just the aggregate figure in the planner. Liquidation is per vault, so one weak vault can be liquidated while the aggregate looks fine.
- **Stability fees differ by asset.** Moving debt to another vault changes what you pay.
- **Isolation limits, but doesn't remove, correlated risk.** A drop in one asset only threatens that asset's vault, but assets that tend to move together will fall together.

---

## Troubleshooting

| Contract error | Cause | Fix |
|----------------|-------|-----|
| `CDPEngine: below min CR` | The withdrawal would push CR under the minimum | Repay first, or withdraw less |
| `CDPEngine: repay leaves debt below floor; use repayAll` | Remaining debt would be under the debt floor | Repay all, or repay less |
| `CDPEngine: below debt floor` | The mint would leave vault debt under the floor | Mint at least up to the floor |
| `CDPEngine: debt ceiling exceeded` | The asset's system-wide debt cap is reached | Mint from another vault |
| `CDPEngine: insufficient collateral` | The mint exceeds the minimum-CR limit | Deposit more, or mint less |
| High price impact on **Trade** | Thin pool liquidity | Split the trade, or choose a different pool in the pool selector |

---

## Next Steps

- **[Risk Management](risk-hedging.md)** - Protect positions from price drops
- **[Collateral Optimization](collateral-optimization.md)** - Choose which vaults carry your debt
- **[Multi-Asset Strategy](multi-asset-strategy.md)** - Combine vaults, pools and Earn products
- **[Swap Guide](../guides/swap.md)** · **[Mint USDST via CDP](../guides/mint-cdp.md)** · **[Safety Guide](../safety.md)**

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
