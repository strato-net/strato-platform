# Arbitrage & Market Making

Capture price differences on STRATO, or earn trading fees by providing liquidity.

---

!!! info "What's available"
    STRATO trading runs through AMM pools. There's **no** order book, limit order, perpetual futures market or built-in trading bot. Everything below is either an app feature or a contract that developers can call.

**Costs on every action:** 0.01 USDST or one voucher per transaction, and approval plus action costs 0.02 USDST. The fee is charged even when a transaction reverts, so failed attempts still cost you. Swaps also pay the pool's swap fee and price impact.

---

## Part 1: Arbitrage

### Pool vs pool, and pool vs oracle

The **Trade** page quotes every pool that holds your pair: constant-product pools, stable pools and each V3 fee tier. It auto-selects the best rate. The trade details also show the **oracle spot price** for reference.

Price gaps show up between pools of the same pair, and between pool prices and the oracle. To act on one:

1. On **Trade**, open the pool selector and choose the cheaper pool to buy.
2. Swap back through the other pool.

Each swap executes against a single pool and is its own transaction, so the round trip isn't atomic. Prices can move between your transactions.

```
Profit ≈ price gap × size
       − swap fee of each pool
       − price impact of each swap
       − transaction fees (0.01 USDST or one voucher each)
```

### USDST peg via the PSM

**Advanced** → **PSM** uses the `DirectMintPSM` contract:

- **Mint:** deposit an eligible token and receive USDST 1:1 minus that token's mint fee. Minting is capped by a per-token balance limit.
- **Redeem:** burn USDST and receive the chosen eligible token 1:1 minus that token's redeem fee, limited to the PSM's balance above a minimum reserve.

If USDST trades below the eligible token in a pool, buying USDST there and redeeming it can close the gap. If it trades above, minting and selling can. Fees and limits are set per token, and the PSM tab applies them when it calculates what you'll receive.

### CDP liquidations

**Advanced** → **Liquidations** lists USDST vaults whose collateralization ratio has fallen below the asset's liquidation ratio. As a liquidator:

- You repay part of the vault's debt in USDST, which is burned. The repayment is capped by the asset's close factor and by the collateral left.
- You receive collateral worth the repaid debt **plus the liquidation penalty**, valued at the **oracle price**.

It's only profitable if you can sell the collateral near the oracle price after fees and price impact. Other liquidators compete for the same vaults.

### Cross-chain

Price differences between STRATO and other chains require bridging, which isn't atomic and has its own time and fees. See the [Bridge Guide](../guides/bridge.md).

### For developers: atomic strategies

Contracts can make multi-step arbitrage atomic:

- **`FlashMint`** mints USDST to your contract, calls `onFlashMint(token, amount, fee, data)`, and burns `amount + fee` in the same transaction. Your contract must be the caller, return the string `"FlashMint.onFlashMint"`, and hold `amount + fee` when the callback returns, or everything reverts. The owner controls the per-loan maximum (`maxLoan`, 0 = disabled), `feeBps` (waived for whitelisted borrowers), a pause switch, and an optional whitelist. Check `maxFlashLoan()` and `canBorrow(address)` before relying on it. There's no app UI or API for FlashMint.
- **`PoolV3.flash`** lends a V3 pool's tokens through a callback; the fee is the pool's fee tier.

---

## Part 2: Market Making (Providing Liquidity)

Step-by-step UI walkthrough: [Provide Liquidity](../guides/liquidity.md).

### Constant-product pools

**Advanced** → **Swap Pools**.

- Pricing is `x × y = k`. Each swap pays `amount in × pool swap fee`. The pool keeps its LP share of that fee for liquidity providers, and the rest goes to the protocol fee collector. Both are set per pool. The factory defaults are a 0.3% swap fee, with 70% of it going to LPs.
- Add both tokens in proportion, or add a single token. With a single token the pool swaps part of it internally, and that internal swap can be charged the swap fee.

### Stable pools

Also under **Advanced** → **Swap Pools**.

- A stableswap curve for assets that should trade near a fixed ratio; some pools hold more than two tokens.
- Swaps, and liquidity changes that unbalance the pool, pay a fee. When the pool's off-peg fee multiplier is set, that fee rises as the pool's balances move away from the peg. Half of collected fees go to the protocol.

### V3 concentrated liquidity

**V3 Liquidity** (PRO section).

1. **Pools** tab: pick a pair and a **fee tier**. The factory enables 0.05%, 0.3% and 1% tiers by default; the owner can enable more.
2. Choose a price range, or a preset: **Stable** (±0.1%), **Tight** (±5%), **Wide** (−50% / +100%), **One-sided lower** (−50%), **One-sided upper** (+100%).
3. Enter an amount and deposit. Positions are held as NFTs.
4. **My Positions** tab: add liquidity, remove a percentage, or collect fees.

Key behavior:

- A position earns fees **only while the pool price is inside its range**.
- When the price leaves the range, the position holds only one of the two tokens and earns nothing until the price returns or you move it.
- A narrow range earns more per dollar while in range, but leaves the range more often. Moving a range means remove, swap and re-deposit, each at full cost.
- A pool may have a protocol fee that takes a share of swap fees.

### Impermanent loss

For a 50/50 constant-product position, when one token's price changes by a factor `r` relative to the other:

```
LP value / value of just holding = 2 × √r / (1 + r)
```

For example, `r = 2` (one token doubles) gives about 0.943, a 5.7% shortfall before fees. Concentrated positions magnify this within their range. Fees earned have to exceed this loss for providing liquidity to beat holding.

### Rewards

Some activity earns Reward Points. The app's swap rewards are registered per pool for constant-product and stable pools. See the [Rewards Guide](../guides/rewards.md) for what currently qualifies.

---

## Risks

| Strategy | Main risks |
|----------|------------|
| Pool arbitrage | Non-atomic legs, price impact, competition |
| PSM | Fee changes, mint caps, redemption liquidity limits, pauses |
| Liquidations | Collateral price falls before you sell; oracle and pool prices differ |
| Cross-chain | Bridge delays, fees and bridge risk |
| Flash strategies | Contract bugs in your code; facility limits or pauses |
| Liquidity provision | Impermanent loss, out-of-range V3 positions, thin volume, smart contract risk |

---

## Next Steps

- **[Provide Liquidity](../guides/liquidity.md)** - Detailed LP walkthrough
- **[Swap Guide](../guides/swap.md)** - Pool types, price impact, slippage
- **[Multi-Asset Strategy](multi-asset-strategy.md)** - LP alongside vaults and Earn
- **[Safety Guide](../safety.md)**

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
