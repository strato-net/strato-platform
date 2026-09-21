# Borrow USDST

Get USDST against your crypto or metal tokens without selling them.

In the STRATO app, **Borrow** (sidebar, under **TRADE**) mints USDST from CDP vaults: you lock collateral and new USDST is created against it. This guide walks through that page. For how vaults, stability fees and liquidation work under the hood, see **[Mint USDST via CDP](mint-cdp.md)**.

!!! note "Lending pool borrowing"
    STRATO also has a lending pool (`LendingPool`) where USDST suppliers lend to borrowers. The app does not currently show a lending-pool borrow form. The Borrow page uses CDP vaults only.

!!! info "Live values"
    Collateral assets, stability fees, liquidation ratios, debt floors and ceilings are set per asset by governance and can change. The app always shows the current values. Any numbers below are illustrations only.

---

## Before You Start

- Sign in to [app.strato.nexus](https://app.strato.nexus) (the Borrow page is read-only for guests).
- Hold a supported collateral token on STRATO. If your assets are on another chain, bridge them first ([Bridge Assets](bridge.md)).
- Keep a little USDST or some vouchers for transaction fees. Every STRATO transaction costs **0.01 USDST, or one voucher if you hold one**. Some actions take more than one transaction (for example, a deposit followed by a mint), and the app shows the total before you confirm. The fee is charged even if a transaction reverts.

---

## Step 1: Choose How Much to Mint

1. Open **Borrow** from the sidebar.
2. In the **Mint against collateral (CDP)** card, enter a **Mint Amount**. **Available to Mint** shows the most you can mint with your current wallet balances and vaults.
3. Set the **Health Factor** slider between **Safer** and **Riskier**. The label under the slider shows the risk level:

    | Target health factor | Label |
    |---|---|
    | 2.5 or higher | Low Risk |
    | 2.0 to 2.5 | Medium Risk |
    | 1.5 to 2.0 | Higher Risk |
    | Below 1.5 | High Risk |

    The slider cannot go below the minimum your vaults allow.

4. Leave **Automatically allocate across vaults** checked to let the app decide how much collateral to deposit, and how much to mint, in each vault. Uncheck it to enter your own numbers in the **Vault Breakdown** table (Asset, Stability Fee, Deposit, Mint, HF).

The card also shows **Average Stability Fee**, the **Transaction Fee** (in USDST and vouchers) and, when rewards are active, **Mint Rewards APY**.

## Step 2: Confirm

1. Click **Confirm Mint**.
2. A progress window lists each transaction. Collateral deposits run first, then the mints. If one step fails, the remaining steps are skipped.
3. When it finishes, the USDST is in your wallet.

---

## What Health Factor Means Here

Each vault holds one collateral asset. For a vault:

```
Collateralization ratio (CR) = collateral value (USD) / debt (USD)
Health factor (HF)           = CR / liquidation ratio of that asset
```

- **HF at or above 1:** the vault cannot be liquidated.
- **HF below 1** (CR below the liquidation ratio): anyone can liquidate part of the vault.
- Minting and withdrawing collateral must also keep CR at or above the asset's **minimum CR**. That minimum is at least the liquidation ratio, so you can never mint straight into a liquidatable position. Price moves afterwards can still get you there.

**Illustration only:** if an asset's liquidation ratio were 150% and your vault held $3,000 of it against 1,000 USDST of debt, CR would be 300% and HF would be 2.0. A 50% fall in that asset's price would bring HF to 1.0.

Debt grows over time through the asset's stability fee, so HF drifts down slowly even when prices don't move.

---

## Step 3: Manage Your Position

Once you have a position, two cards appear beside the mint card:

- **Your Position:** Total Debt, Average Stability Fee, Average Health Factor, Vault Collateral Supplied.
- **Your Vaults:** one row per collateral asset, with its health factor and four actions:

| Action | What it does | Max option |
|---|---|---|
| **Deposit** | Add collateral to the vault (raises HF) | - |
| **Withdraw** | Take collateral back (lowers HF) | **Withdraw Max** withdraws the most you can while keeping CR at or above the minimum |
| **Mint** | Mint more USDST from this vault (lowers HF) | **Mint Max USDST** |
| **Repay** | Burn USDST to reduce this vault's debt (raises HF) | **Repay All USDST** |

Each action previews the vault's new health factor before you confirm.

!!! warning "Watch your health factor"
    If a vault's health factor falls, add collateral or repay debt before it reaches 1. The Portfolio page shows a warning when a vault is close to liquidation.

---

## Step 4: Repay and Close

1. Get enough USDST to cover the debt plus accrued stability fees. You can [swap](swap.md) for it or use USDST you already hold.
2. In **Your Vaults**, choose **Repay** on the vault. Enter an amount, or use the max option (**Repay All USDST**) to clear the vault's debt.
3. Choose **Withdraw** (or **Withdraw Max**) to take your collateral back.

!!! note "Debt floor"
    Each asset can have a minimum debt per vault. A mint that would leave the vault below that floor is rejected. So is a partial repay: in that case, repay in full with **Repay All USDST**.

---

## If You Get Liquidated

When a vault's health factor drops below 1, any user can repay part of its debt and take collateral worth that amount plus a per-asset liquidation penalty. **Advanced > Liquidations** lists positions that can be liquidated. You keep the USDST you minted but lose the seized collateral. For how much can be taken and how it's priced, see [Mint USDST via CDP](mint-cdp.md#liquidation).

---

## Costs

| Cost | How it works |
|---|---|
| **Stability fee** | Annual rate set per collateral asset. It compounds every second and is added to your debt. The app shows it for each vault. |
| **Transaction fee** | 0.01 USDST or one voucher for each STRATO transaction |
| **Liquidation penalty** | Only charged if your vault is liquidated |

---

## Common Errors

| Message | Meaning | What to do |
|---|---|---|
| Insufficient Collateral | Your balances can't support the mint amount at the chosen health factor | Lower the amount, move the slider toward Riskier, or add collateral |
| Debt floor prevents allocation / below debt floor | The mint would leave a vault under its minimum debt | Mint more, or pick a different vault |
| repay leaves debt below floor | A partial repay would leave debt under the floor | Use **Repay All USDST** |
| below min CR | The withdrawal or mint would push CR under the minimum | Withdraw or mint less, or repay first |
| debt ceiling exceeded | Total USDST minted against this asset is at its limit | Use another collateral asset |
| Mint/Withdraw paused by admin | The asset or the engine is paused | Wait, or use another asset |

---

## Next Steps

- **[Mint USDST via CDP](mint-cdp.md):** vault mechanics in detail
- **[Swap Tokens](swap.md):** trade your USDST
- **[Earn Rewards](rewards.md):** CDP minting can be a reward activity
- **[Safety Guide](../safety.md):** oracle and liquidation risk
