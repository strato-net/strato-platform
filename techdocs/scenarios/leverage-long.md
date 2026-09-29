# Leverage Long Position

Increase your exposure to an asset by minting USDST against it and buying more of the same asset.

---

!!! danger "High-risk strategy"
    Leverage amplifies gains **and** losses and moves your liquidation price closer. A liquidated vault loses collateral worth the repaid debt plus a liquidation penalty. Only use funds you can afford to lose, start small, and read [Risk Management](risk-hedging.md) first.

!!! info "What leverage means on STRATO"
    STRATO has no margin trading, perpetual futures or one-click leverage. "Leverage" here means looping by hand: mint USDST from a vault on the **Borrow** page (CDP), swap it for more of the collateral asset, and deposit that too. Every step is a separate transaction you submit and pay for.

---

## How the Loop Works

1. **Borrow**: deposit the asset into its vault and mint USDST.
2. **Trade**: swap the USDST for more of the same asset.
3. **Borrow**: deposit the purchased asset into the same vault.
4. Optionally mint again and repeat. Each round adds less than the one before.

### The Math

These formulas follow from `CDPEngine`. They ignore swap fees, price impact, transaction fees and stability fees, all of which reduce your real result.

If every round mints down to the same collateralization ratio `c` (as a ratio, e.g. 2.0 for 200%):

```
Exposure after many rounds  → c / (c − 1)  × your starting collateral
Debt after many rounds      → 1 / (c − 1)  × your starting collateral value
Each round adds             1 / c of the previous round
```

`c` can't go below the asset's **minimum CR**, because minting must keep `debt < collateral value ÷ minimum CR`.

Liquidation depends on the vault's Health Factor (**HF = CR ÷ liquidation ratio**), not on how many rounds you did:

```
Price drop to liquidation = 1 − 1 / HF
Liquidation price         = entry oracle price / HF
```

!!! example "Hypothetical illustration (not current parameters)"
    If an asset's liquidation ratio were 150% and you looped at a 200% CR, your HF would be about 1.33. Exposure would approach 2× your starting collateral, and a price drop of about 25% would make the vault liquidatable. Check the real parameters for your asset in the app.

---

## Step-by-Step

### Step 0: Check the Parameters

On **Borrow**, look at the vault for your asset: stability fee, current Health Factor, and how much you can mint. The asset's minimum CR, liquidation ratio, liquidation penalty, close factor and debt floor bound what's possible. (Developers can read them with `CDPEngine.collateralParams(asset)`.)

Before you start, make sure that:

- [ ] You understand per-vault liquidation ([Mint USDST via CDP](../guides/mint-cdp.md))
- [ ] You can check the position regularly (the app has no alerts)
- [ ] You have spare funds to add collateral or repay
- [ ] The pool for USDST → asset on **Trade** has enough liquidity for your size

### Step 1: Deposit and Mint

1. Go to **Borrow**.
2. In the **Mint** form, enter the USDST amount and set the target Health Factor with the slider. The form shows how it will allocate the deposit and mint across vaults. For a single-asset loop, make sure the allocation uses only your chosen asset's vault; switch off auto-allocation if needed.
3. Review and confirm. You can also use the vault's own **Deposit** and **Mint USDST** actions.

### Step 2: Swap USDST for the Asset

1. Go to **Trade**, choose USDST → your asset.
2. Check price impact and slippage. The app routes to the best-rate pool by default.
3. Confirm. Keep some USDST for transaction fees (0.01 USDST or one voucher per transaction).

### Step 3: Deposit the Purchased Asset

1. **Borrow** → your vault → **Deposit**.
2. Your vault's Health Factor rises because collateral increased and debt didn't.

### Step 4: Repeat (Optional)

**Mint USDST** from the vault again while keeping Health Factor at or above your target, then repeat Steps 2–3. Stop when the extra exposure isn't worth the added costs and risk.

---

## Costs

| Cost | Where it comes from |
|------|---------------------|
| Stability fee | Per-asset rate, compounds per second into vault debt (shown on the vault) |
| Swap fee | Charged by the pool on every swap; varies by pool |
| Price impact | Larger swaps in thinner pools get worse prices |
| Transaction fee | 0.01 USDST or one voucher per transaction, even if it reverts; approval plus action costs 0.02 USDST |

A leveraged position loses money in a flat market because the stability fee keeps accruing.

---

## Managing the Position

**If the price falls:**

- **Deposit** more collateral into the vault, or
- **Repay** USDST (partial repays can't leave debt below the debt floor), or
- **De-lever:** withdraw some collateral (only while CR stays at or above the minimum CR), swap it to USDST, and repay. Repeat in rounds.

**To close completely:**

1. Swap enough of the asset (from your wallet, or withdrawn within the minimum-CR limit) to USDST.
2. **Repay All USDST** on the vault. Repay All burns the full debt including accrued stability fee.
3. **Withdraw** the remaining collateral. With zero debt there's no CR check.

If you can't withdraw enough to repay at once, alternate **Withdraw Max** → swap → **Repay** until the debt is gone.

---

## Troubleshooting

| Contract error | Meaning |
|----------------|---------|
| `CDPEngine: insufficient collateral` | Mint would exceed the minimum-CR limit; mint less |
| `CDPEngine: below min CR` | Withdrawal would push CR under the minimum; repay first |
| `CDPEngine: debt ceiling exceeded` | The asset's system-wide debt cap is reached |
| `CDPEngine: below debt floor` | Vault debt would be under the per-asset minimum |

---

## Next Steps

- **[Risk Management](risk-hedging.md)** - Buffers, repay/deposit formulas, monitoring
- **[Swap Guide](../guides/swap.md)** - Pool types, price impact and slippage
- **[Exit Strategy](withdrawals.md)** - Close positions and withdraw
- **[Safety Guide](../safety.md)**

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
