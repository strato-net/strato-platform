# Swap Tokens

Trade one token for another against STRATO's on-chain liquidity pools.

!!! info "Live quotes"
    Rates, fees and price impact depend on each pool's reserves and settings. Always check the quote in the app before you confirm.

---

## Before You Start

- Sign in to [app.strato.nexus](https://app.strato.nexus). You must be signed in to trade.
- Hold the token you want to sell on STRATO. Use **Fund** to bridge assets in ([Bridge Assets](bridge.md)).
- Keep a little USDST or some vouchers for fees. Every STRATO transaction costs **0.01 USDST, or one voucher if you hold one**. A trade usually needs an approval plus the swap, and the **Transaction Fee** line shows the total.

---

## Step-by-Step

1. Open **Trade** from the sidebar (under **TRADE**). The card is titled **Trade your assets**.
2. **From:** pick the token you're selling and enter an amount. You can also type the amount you want to receive in **To**.
3. **To:** pick the token you want.
4. **Pick a pool (optional).** The app shows a card for each pool that trades this pair, each with its own quote:
    - **Classic pool**: constant-product pool
    - **Stable pool**: pool for assets that should trade near par
    - **Concentrated liquidity**: range-based (V3-style) pool

    The app selects the pool with the best rate. Click a card to use that pool instead. Changing the pair clears your choice.

5. **Review the details:**
    - **Exchange Rate**
    - **Price Impact**: the gap between the pool's current price and your average price. Larger trades mean higher impact.
    - **Transaction Fee**
    - **Max slippage**: **Auto** or **Manual** (see below)
6. Click **Trade Assets**.
7. In **Confirm Trade**, check **You pay**, **You receive**, **Minimum received (after slippage)** and **Exchange rate**, then confirm.

Your recent trades appear in the history table below the widget (desktop only).

!!! note "One pool per trade"
    A trade runs against a single pool. The app doesn't split orders or route through an intermediate token. If no pool trades your pair directly, swap in two steps (for example, token A to USDST, then USDST to token B).

---

## Slippage

Slippage tolerance sets the lowest output you'll accept. If the pool price moves against you before your trade executes and the output would fall below **Minimum received**, the trade reverts.

- **Auto** (default): 1.5 × the quoted price impact, but never below 0.5% or above 5%.
- **Manual:** set anywhere from 0.1% to 10% (starts at 0.5%). The app warns you below 0.5% or above 5%.

---

## Pool Types and Swap Fees

The swap fee is taken from the input amount inside the pool. It is separate from the STRATO transaction fee.

| Pool type | Pricing | Swap fee |
|---|---|---|
| **Classic** (`Pool`) | Constant product, `x × y = k` | Factory default 0.30%; can be set per pool (up to 10%). By default 70% goes to liquidity providers and 30% to the protocol fee collector. |
| **Stable** (`StablePool`) | StableSwap curve (ported from Curve StableSwap-NG). Low slippage near par; can hold two or more tokens. | Base fee set at creation (the factory uses the classic default) with a dynamic multiplier that raises the fee when the pool is off-peg. Half of fees go to the protocol. |
| **Concentrated liquidity** (`PoolV3`) | Uniswap-v3-style ranges | Fee tier per pool: 0.05%, 0.30% or 1.00%. A configurable share can go to the protocol. |

The quote in the app already includes the pool's swap fee.

---

## Common Issues

| Message | Meaning | What to do |
|---|---|---|
| Insufficient balance | You don't hold enough of the From token | Lower the amount |
| Amount exceeds pool liquidity | The pool can't fill this size | Trade less, or pick another pool card |
| No quote / Insufficient liquidity (on a pool card) | That pool can't quote this trade | Use a different pool |
| Pool is paused by admin at this time / This pool is disabled | Trading in that pool is stopped | Pick another pool or wait |
| Transaction reverted | The price moved past your slippage tolerance, or you ran out of fee balance | Refresh the quote, raise slippage carefully, or top up USDST or vouchers. A reverted transaction still pays its fee. |

---

## Tips

- **Large trades:** check **Price Impact** first. Splitting a trade doesn't reduce the total fee, but it can reduce impact if other traders or arbitrage rebalance the pool in between.
- **Stable pairs:** for tokens that should trade near $1 (for example USDST and other stablecoins), a **Stable pool** card usually quotes best.
- **Verify tokens:** check the symbol and icon before trading. Anyone can see pool contents on-chain, but not every token is what its name suggests.

---

## Next Steps

- **[Provide Liquidity](liquidity.md):** earn swap fees as a liquidity provider
- **[Borrow USDST](borrow.md):** mint USDST against collateral
- **[Earn Rewards](rewards.md):** reward activities for pools
