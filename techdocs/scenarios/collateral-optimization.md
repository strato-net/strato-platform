# Collateral Optimization

Decide which collateral carries your USDST debt, balancing borrowing capacity, liquidation distance and cost.

---

## The Parameters That Matter

Each collateral asset in `CDPEngine` has its own settings. They differ by asset and can change, so this page doesn't list values. Read them in the app, or with `CDPEngine.collateralParams(asset)` if you're a developer.

| Parameter | Effect |
|-----------|--------|
| **Minimum CR** | Mints and withdrawals (while in debt) must keep CR at or above this. Sets your maximum borrowing. |
| **Liquidation ratio** | The vault can be liquidated when CR falls below it. The app's Health Factor = CR ÷ liquidation ratio. |
| **Stability fee** | Per-second compounding rate added to the vault's debt |
| **Liquidation penalty** | Extra collateral, on top of the repaid debt, that a liquidator receives |
| **Close factor** | Maximum share of a vault's debt one liquidation can repay |
| **Debt floor** | Vault debt must be zero or at least this amount |
| **Debt ceiling** | System-wide cap on USDST minted against the asset |

On **Borrow**, each vault shows its collateral, debt, Health Factor and stability fee.

---

## The Trade-offs, as Formulas

For one vault, with collateral value `V` at the oracle price:

```
Maximum debt              < V / minimum CR
Health Factor             = (V / debt) / liquidation ratio
Price drop to liquidation = 1 − 1 / Health Factor        (debt held constant)
Yearly cost               ≈ debt × stability fee rate     (compounding adds a little)
```

So for each asset you're choosing between:

- **Capacity:** a lower minimum CR lets you mint more per dollar of collateral.
- **Distance to liquidation:** set by the Health Factor you keep, not by the maximum you could mint.
- **Cost:** the stability fee on the debt you place in that vault.
- **Price behavior:** a volatile asset reaches a given price drop sooner than a stable one.

---

## Why Vault Isolation Matters

Each asset's vault stands alone:

- Collateral in one vault never backs debt in another.
- A price drop in asset A can only liquidate vault A.
- Assets that tend to move together will still fall together, so isolation doesn't create diversification by itself.
- More vaults means more debt floors to meet and more positions to watch.

!!! info "Lending pool: pooled collateral"
    The `LendingPool` contract uses a different, pooled model where all collateral backs one loan:

    ```
    Health factor = Σ(collateral_i × price_i × liquidation threshold_i) / debt value
    Borrow limit  = Σ(collateral_i × price_i × LTV_i) / USDST price
    ```

    A loan there is liquidatable below health factor 1.0. A liquidator may repay up to 50% of the debt while the health factor is at least 0.95, and up to 100% below that. The liquidator receives collateral worth the repaid debt times the asset's liquidation bonus (a configured value between 100% and 125%). **The lending pool's borrow screens are hidden in the current app**; the **Borrow** page uses CDP vaults.

---

## How the App Helps

The **Mint** form on **Borrow** already optimizes for cost when you mint a target amount with auto-allocation on:

1. It sorts vaults by **stability fee** (lowest first), then by existing collateral, then by available headroom.
2. It fills them in that order while keeping the **target Health Factor** you set with the slider.
3. It skips allocations that would break a debt floor or debt ceiling.

Switch off auto-allocation to override this, for example to keep debt off an asset you expect to be volatile even if its fee is lower.

---

## Optimization Moves

### Move debt to a cheaper vault

1. **Mint USDST** from vault B (lower stability fee), keeping its Health Factor at your target.
2. **Repay** the same amount in vault A.
3. Optionally **Withdraw** the collateral freed in vault A.

Cost: a few transactions at 0.01 USDST (or one voucher) each. Worth it only if the fee difference on the moved debt exceeds that over your holding period.

### Add headroom where it's thinnest

If one vault's Health Factor is much lower than the others, **Deposit** more of that asset or repay that vault first. The aggregate figure won't warn you.

### Change the collateral mix

Swap part of one collateral asset into another and move it between vaults. Follow the step order in [Portfolio Rebalancing](portfolio-rebalancing.md) so no vault drops below its minimum CR.

---

## When to Revisit

- A vault's Health Factor drops below your own threshold (the app highlights values below 1.5)
- Stability fees or other parameters change
- An asset's debt ceiling is reached and new mints fail
- Your view of an asset's risk changes

Every move costs transaction fees, swap fees and price impact, so don't rebalance for tiny improvements.

---

## Next Steps

- **[Portfolio Rebalancing](portfolio-rebalancing.md)** - Step order for moving collateral
- **[Multi-Asset Strategy](multi-asset-strategy.md)** - Combine vaults with pools and Earn
- **[Risk Management](risk-hedging.md)** - Buffers and monitoring
- **[Mint USDST via CDP](../guides/mint-cdp.md)** · **[Safety Guide](../safety.md)**

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
