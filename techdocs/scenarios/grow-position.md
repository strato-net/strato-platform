# Grow Your Position (Conservative Looping)

Increase your exposure to an asset by minting USDST against it, buying more of the asset, and depositing that as collateral.

!!! warning "Leverage cuts both ways"
    Looping amplifies gains **and** losses, and it raises your liquidation price. All prices, ratios and results on this page are **illustrative examples**. Check each vault's actual parameters on the Borrow page before acting.

---

## The Loop

```
Deposit collateral → Mint USDST → Trade USDST for more of the asset → Deposit it → Repeat
```

Everything happens on two pages: **Borrow** (CDP vaults) and **Trade** (swaps).

## Mechanics You Need

Each collateral asset has its own CDP vault with its own parameters:

| Term | Meaning |
|------|---------|
| Collateralization ratio (CR) | Collateral value / USDST debt |
| Health factor | CR / liquidation ratio. Shown in the app. |
| Liquidation ratio | If CR falls below it (health factor < 1.0), the vault can be liquidated |
| Minimum CR | Minting and collateral withdrawals must keep CR at or above this (it is at least the liquidation ratio) |
| Liquidation penalty | Extra collateral taken from you when you are liquidated |
| Close factor | Maximum share of your debt a single liquidation can repay |
| Stability fee | Interest that accrues continuously on your debt |
| Debt floor | Minimum debt a vault can carry |

Vaults are liquidated **independently**: collateral in one vault does not protect another. See the [Mint USDST (CDP) Guide](../guides/mint-cdp.md).

---

## Step-by-Step

### Round 1

1. **Mint:** Open **Borrow**, enter a **Mint Amount**, and move the risk slider toward **Safer**. Check **Projected Vault Health**, then click **Mint**. The app deposits the collateral and mints USDST.
2. **Buy:** Open **Trade** and swap USDST for the asset. Review **Price Impact**, **Minimum received** and your slippage tolerance. Standard pools charge a swap fee (0.3% by default; individual pools can differ).
3. **Deposit:** On **Borrow → Your Vaults**, choose the asset's vault and click **Deposit**.

### Round 2 and later

4. On **Your Vaults**, choose **Mint USDST** for a smaller amount, keeping the health factor at your target.
5. Trade and deposit again.
6. Stop when you reach your target exposure or health factor.

---

## Illustrative Example

Assumptions (hypothetical): 5 ETH at $3,000, a 150% liquidation ratio, and swap fees ignored for simplicity.

| Stage | Collateral | Debt | CR | Health factor |
|-------|-----------|------|----|---------------|
| Deposit 5 ETH, mint 5,000 USDST | 5.00 ETH ($15,000) | 5,000 | 300% | 2.00 |
| Buy ~1.66 ETH, deposit | 6.66 ETH ($19,980) | 5,000 | 400% | 2.66 |
| Mint 2,500 more | 6.66 ETH ($19,980) | 7,500 | 266% | 1.78 |
| Buy ~0.83 ETH, deposit | 7.49 ETH ($22,470) | 7,500 | 300% | 2.00 |

Result: 7.49 ETH of exposure on $14,970 of equity, or about **1.5x leverage**.

**Price moves (same position):**

| ETH price | Health factor | Status |
|-----------|---------------|--------|
| $3,000 | 2.00 | Starting point |
| $2,550 (−15%) | 1.70 | Buffer shrinking |
| $2,100 (−30%) | 1.40 | Add collateral or repay |
| ~$1,500 (−50%) | ~1.00 | Liquidatable |

Health factor here = (7.49 × price) / (7,500 × 1.5). The stability fee keeps adding to the debt, so the liquidation price rises slowly over time.

---

## Managing and Unwinding

**Improve health factor:** On **Your Vaults**, **Deposit** more collateral or **Repay USDST**.

**Unwind the loop:**

1. On **Trade**, swap some of the asset back to USDST.
2. On **Your Vaults**, click **Repay USDST** (or **Repay All USDST**, which needs enough USDST to cover the accrued stability fee).
3. **Withdraw** (or **Withdraw Max**) the collateral. While debt remains, withdrawals must keep CR above the minimum CR.

**Liquidations:** Anyone can liquidate an unsafe vault from **Advanced → Liquidations**. The liquidator repays part of your debt (up to the close factor) and receives collateral plus the penalty.

---

## Using Other Collateral

You can loop with any asset the Borrow page lists as eligible collateral (for example WBTC, GOLDST or SILVST). You can also buy a different asset each round to diversify. Each asset is a separate vault with its own parameters and health factor, so monitor every vault you open.

## Costs to Account For

- Stability fee on your USDST debt, shown per vault
- Swap fees and price impact on each trade
- STRATO transaction fees: 0.01 USDST or one voucher per call

The loop only pays off if the asset's price gain beats these costs.

---

## Related

- [Mint USDST (CDP) Guide](../guides/mint-cdp.md)
- [Swap Guide](../guides/swap.md)
- [Withdrawals](withdrawals.md)
- [Safety Guide](../safety.md)
