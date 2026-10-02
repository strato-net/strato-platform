# Provide Liquidity

Deposit tokens into STRATO swap pools and earn a share of trading fees.

!!! warning "Returns are not guaranteed"
    What you earn depends on trading volume, the pool's fee and your share of the pool. Liquidity positions can lose value compared with just holding the tokens (impermanent loss). Any APY the app shows comes from recent data, not a promise.

---

## Where Liquidity Lives in the App

| Pool type | Where | What you receive |
|---|---|---|
| **Classic** and **Stable** pools | **Advanced > Swap Pools** (sidebar, under **PRO**) | LP tokens |
| **Concentrated liquidity** (V3) | **V3 Liquidity** (sidebar, under **PRO**) | A position NFT |

A pool also has its own detail page with **Deposit**, **Withdraw** and **Pool Stats**. The Rewards page's **Earn Now** buttons and APY links open these pages.

Every STRATO transaction costs **0.01 USDST, or one voucher if you hold one**. Depositing usually takes approvals plus the deposit, and each dialog shows the total **Transaction fee**.

---

## Classic and Stable Pools

### How They Work

- **Classic pools** (`Pool`) hold two tokens and price trades with `x × y = k`. Depositing mints LP tokens in proportion to your share of the reserves. Swap fees stay in the reserves (70% of the fee by default; the rest goes to the protocol), so each LP token redeems for more over time.
- **Stable pools** (`StablePool`) use a StableSwap curve for assets that should trade near par. They can hold two or more tokens. LP tokens work the same way.

```
Your share of the pool = your LP tokens / total LP token supply
```

### Add Liquidity

1. Go to **Advanced > Swap Pools** and find the pool.
2. Click **Deposit**. The **Deposit Liquidity** dialog opens.
3. Choose to deposit **both tokens** or **a single token**:
    - **Both tokens:** enter one amount. The other is calculated from the **Current pool ratio**.
    - **Single token:** the pool swaps part of your deposit into the other token internally, then adds both. That internal swap may or may not charge the swap fee, depending on the pool's setting.
4. Review the amounts and **Transaction fee**, then click **Confirm Deposit**.

If you're the first depositor in an empty pool, the amounts you enter set the starting price.

### Remove Liquidity

1. In **Advanced > Swap Pools**, click **Withdraw** on the pool. It's disabled if you hold no LP tokens.
2. In **Withdraw Liquidity**, choose the **Percent** of your LP tokens to redeem.
3. Click **Confirm Withdraw**. You receive the pool's tokens in proportion to your share, including accumulated fees.

---

## Concentrated Liquidity (V3)

V3 pools (`PoolV3`) let you provide liquidity within a price range. Inside that range your capital earns more fees than it would spread across all prices. Outside it, your position earns nothing and holds only one of the two tokens.

Each V3 pool has a fee tier: **0.05%**, **0.30%** or **1.00%**.

### Open a Position

1. Open **V3 Liquidity** and select a pool on the **Pools** tab (it shows the **Fee tier**).
2. In **New position**, set **Min price** and **Max price**. Min must be below max.
3. Enter a **Deposit amount**. The app works out the amount of the other token for your range.
4. Click **Add Liquidity** and confirm.

Each position is an NFT in your wallet. It also appears on the NFTs page.

### Manage Positions

The **My Positions** tab lists each position, whether it is **In range** or **Out of range**, its **Position value** and **Uncollected (incl. pending fees)**. From there you can:

- **Add liquidity** to an existing position
- **Collect fees**: V3 fees are not reinvested automatically, so you collect them yourself
- **Remove liquidity**

---

## Impermanent Loss

When the prices of a pool's tokens move apart, the pool rebalances and you end up with more of the token that fell and less of the one that rose. Compared with just holding, that shows up as a loss.

**Illustration only** (classic pool, fees ignored):

- You deposit 1 token A at $3,000 plus 3,000 USDST, for $6,000 total.
- Token A's price doubles to $6,000.
- The pool now gives you about 0.707 A plus 4,243 USDST, worth about **$8,485**.
- Holding would have been worth **$9,000**.
- Impermanent loss: about **$515 (5.7%)**.

The loss only becomes permanent if you withdraw while prices are apart. Fees you earn offset it. Pairs that move together (such as two stablecoins in a stable pool) have much less of it.

Concentrated positions magnify both effects: fees are higher in range, and the rebalancing is sharper.

---

## Rewards for Liquidity

Some pools are **reward activities**. While you hold a position you earn Reward Points on top of fees. The **Activities** tab on the Rewards page lists which pools qualify and their emission rates. See [Manage Rewards](rewards.md).

---

## Common Issues

| Message | Meaning | What to do |
|---|---|---|
| Insufficient balance | You don't hold enough of a token | Lower the amount or swap for the missing token |
| Pool is paused by admin at this time | Deposits and swaps are stopped | Wait. Some withdrawals may still be available. |
| Enter a price range / Min price must be below max price | V3 range is missing or invalid | Fix the range |
| Amount too small | The deposit rounds to zero liquidity | Deposit more |

---

## Next Steps

- **[Swap Tokens](swap.md):** how traders use these pools
- **[Manage Rewards](rewards.md):** claim Reward Points
- **[Core Concepts](../concepts.md#impermanent-loss-liquidity-provision):** impermanent loss in more depth
