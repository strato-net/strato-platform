# Mint USDST via CDP

How CDP (Collateralized Debt Position) vaults create USDST, and how to manage them.

The app's **Borrow** page runs on CDP vaults. For the step-by-step flow, see **[Borrow USDST](borrow.md)**. This page explains the mechanics behind it (contract: `CDPEngine`).

!!! info "Live values"
    Every parameter below is set per collateral asset by governance. The app shows current values. The only numbers given here are the ranges the contract enforces.

---

## Vaults

- You get **one vault per collateral asset**. A vault holds one asset and tracks the USDST debt minted against it.
- Collateral sits in the protocol's CDP vault contract, not in your wallet.
- Each vault is valued, fee-charged and liquidated **on its own**. A healthy ETH vault does not protect an unhealthy gold vault.
- The Borrow page's automatic allocation can spread a single mint across several vaults. **Your Vaults** lists each one separately.

---

## Per-Asset Parameters

| Parameter | Meaning | Contract rule |
|---|---|---|
| **Liquidation ratio** | CR below which the vault can be liquidated | At least 100% |
| **Minimum CR** | CR that mints and withdrawals must keep | At least the liquidation ratio |
| **Stability fee** | Rate added to debt over time, compounded every second | Can't be negative |
| **Debt floor** | Minimum debt a vault with debt must carry | Not above the ceiling |
| **Debt ceiling** | Most USDST that can be outstanding against this asset | 0 = no ceiling |
| **Liquidation penalty** | Extra collateral a liquidator receives | 5% to 30% |
| **Close factor** | Most of a vault's debt one liquidation can repay | 50% to 100% |

Admins can also pause one asset or the whole engine. While paused, minting and withdrawing are blocked for that asset. Deposits still require the collateral token to be active.

---

## The Math

```
Debt (USD)            = scaled debt × rate accumulator
Collateral value      = collateral amount × oracle price
CR                    = collateral value / debt
Health factor         = CR / liquidation ratio
Max you can mint      = collateral value / minimum CR − current debt
```

- **Debt is in USD terms and USDST is treated as $1.** Minting 1,000 USDST adds 1,000 of debt.
- **Stability fee:** each asset has a rate accumulator that grows every second at the stability fee rate. Your debt is your share of that accumulator, so it grows continuously without you doing anything. Fees are minted as USDST and split between the CDP reserve and the protocol fee collector.
- **Prices** come from the on-chain `PriceOracle`, which an off-chain oracle service updates. See [Safety](../safety.md#oracle-risk).

The Borrow page and **Your Vaults** show CR as a health factor, so 1.0 means you are exactly at the liquidation ratio.

---

## Rules for Vault Actions

The contract enforces these rules on the actions in **Borrow > Your Vaults** (the steps are in [Borrow USDST](borrow.md#step-3-manage-your-position)):

| Action | Allowed when |
|---|---|
| Deposit | The collateral token is active. Deposits always raise the health factor. |
| Withdraw | CR stays at or above the minimum CR, and the asset isn't paused |
| Mint | CR stays at or above the minimum CR, the debt ceiling isn't exceeded, the vault ends at or above the debt floor, and the asset isn't paused |
| Repay | The vault's debt doesn't end between zero and the debt floor. Repay-all burns the full debt, including accrued fees. |

!!! tip "Keep a buffer"
    Minting right up to the minimum CR leaves almost no room for price moves or fee accrual. Keep a margin you are comfortable with, especially for volatile collateral.

---

## Liquidation

A vault can be liquidated once **CR < liquidation ratio** (health factor below 1). Liquidation is a direct sale at the oracle price, with no auction:

1. A liquidator picks your vault and an amount of debt to cover. **Advanced > Liquidations** lists candidates.
2. The repaid amount is capped by the smallest of:
    - your total debt
    - the close factor (a share of your debt)
    - the amount your collateral can cover **including the penalty**
3. The liquidator burns that much USDST.
4. They receive collateral worth `repaid debt × (1 + penalty)` at the oracle price. The amount is clamped to what the vault holds.
5. If only dust collateral remains, it is seized too.

Afterwards your vault has less debt and less collateral. The penalty is your loss.

### Bad Debt

If a liquidation takes all of a vault's collateral and debt still remains, that remainder is recorded as **bad debt** for the asset. **Advanced > Bad Debt** shows the total per asset. Users can burn USDST to pay down bad debt through **junior notes**. A junior note is later repaid from CDP reserve inflows, up to a cap that includes a premium.

---

## Other Ways to Get USDST

- **[Swap](swap.md)** another token for USDST on the Trade page.
- **Advanced > PSM** (Direct Mint PSM) mints USDST against supported tokens, and redeems USDST for them, at a per-token fee.
- **Bridge in stablecoins** on the Fund page when a route delivers USDST ([Bridge Assets](bridge.md)).

---

## Next Steps

- **[Borrow USDST](borrow.md):** step-by-step minting in the app
- **[Provide Liquidity](liquidity.md):** put USDST to work
- **[Safety Guide](../safety.md):** liquidation, oracle and admin risk
