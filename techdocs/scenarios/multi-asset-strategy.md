# Multi-Asset DeFi Strategy

Combine several collateral vaults, pools and Earn products into one position, and understand the risks each layer adds.

---

## The Building Blocks

Everything below is in the current app (sidebar section in brackets):

| Building block | Where | What it does |
|----------------|-------|--------------|
| USDST vaults (CDP) | **Borrow** [TRADE] | One vault per collateral asset; mint USDST against it |
| Swaps | **Trade** [TRADE] | Best-rate routing across constant-product, stable and V3 pools |
| Metals | **Fund** → **Buy Metals** [TRADE] | Mint GOLDST / SILVST at the oracle price, less a mint fee |
| Pool liquidity | **Advanced** → **Swap Pools** [PRO] | Add liquidity to constant-product and stable pools |
| Concentrated liquidity | **V3 Liquidity** [PRO] | Provide liquidity in a price range you choose |
| Earn products | **Earn** [EARN] | USDST Savings Vault; Yield Vaults (ETH, WBTC, USDC, GOLDST, SILVST, shown as "Coming Soon" until deployed); Stake STRATO |
| Diversified Vault | **Advanced** → **Diversified Vault** [PRO] | Multi-asset vault that pools deposits and deploys them through a bot executor |
| Reward Points | **Rewards** [EARN] | Points for eligible activity; see [Rewards Guide](../guides/rewards.md) |

Every transaction costs 0.01 USDST or one voucher, even if it reverts; approval plus action costs 0.02 USDST. APYs shown in the app are current, variable figures, not promises.

---

## Phase 1: Spread Collateral Across Vaults

1. Hold the assets you want as collateral (bridge them in via **Fund**, swap on **Trade**, or buy metals).
2. Go to **Borrow**. In the **Mint** form, enter how much USDST you want and set a target Health Factor.
3. With auto-allocation on, the planner deposits from your wallet and splits the mint across vaults. It prefers lower stability fees first, then vaults that already hold collateral, then headroom, and respects each asset's debt floor and debt ceiling. Switch it off to set each vault's deposit and mint yourself.
4. Review the per-vault breakdown and confirm.

!!! warning "Aggregate vs per-vault health"
    The planner shows an aggregate Health Factor: total collateral ÷ total debt, divided by the debt-weighted average liquidation ratio. **Liquidation is per vault**, when that vault's CR drops below its own liquidation ratio. Check each vault in the vault list.

---

## Phase 2: Put the USDST to Work

Options, from lower to higher complexity:

- **Keep a buffer** in your wallet for repaying or topping up vaults (see [Risk Management](risk-hedging.md)).
- **USDST Savings Vault** on **Earn**.
- **Stable pools** (**Advanced** → **Swap Pools**): pools for assets that should trade near a fixed ratio, such as stablecoin pairs. Their fee rises dynamically when the pool moves off peg.
- **Constant-product pools** (**Advanced** → **Swap Pools**): pair USDST with a volatile asset. You can add both tokens or a single token (the pool swaps half internally). Exposes you to impermanent loss.
- **V3 concentrated liquidity** (**V3 Liquidity**): choose a fee tier and price range. It earns fees only while the price is in range. See [Arbitrage & Market Making](arbitrage-market-making.md).

!!! note "Your debt stays in USDST"
    Whatever you do with minted USDST, the vault debt stays fixed in USDST and keeps accruing stability fees. If an LP position loses value (impermanent loss or a price drop), you still owe the full debt.

---

## Phase 3: Diversify What You Hold

- Swap between assets on **Trade**.
- Add metal exposure through **Fund** → **Buy Metals**. MetalForge only mints; you exit a metal position by swapping on **Trade**.
- Deposit GOLDST or SILVST into their Yield Vaults on **Earn** if they're live.

---

## Economics

There are no fixed returns. For any period, roughly:

```
Net result = pool fees + Earn yield + value of Reward Points
           + change in asset prices
           − stability fees on all vaults
           − swap fees and price impact
           − transaction fees (0.01 USDST or one voucher each)
           − impermanent loss on LP positions
```

Stability fees, pool volumes, Earn yields and prices all change, so re-check them in the app before and during the strategy.

---

## Risks Stack Up

| Layer | Main risk |
|-------|-----------|
| Vaults | Per-vault liquidation with a penalty; debt grows with stability fees |
| Pools | Impermanent loss; V3 positions stop earning when out of range |
| Earn products | Strategy and contract risk; check each product page for how withdrawals work before counting on it as a buffer |
| Bridged assets | Bridge risk |
| All | Oracle, smart contract and admin-parameter risk |

---

## Routine

**Weekly:**

- [ ] Health Factor of **each** vault
- [ ] Stability fees and debt per vault
- [ ] LP positions: value, and whether V3 ranges are still in range
- [ ] Earn positions and current APYs
- [ ] USDST or vouchers available for transaction fees

**When allocations drift:** follow [Portfolio Rebalancing](portfolio-rebalancing.md).

---

## Exit Order

1. Remove liquidity (**Advanced** → **Swap Pools**, **V3 Liquidity** → **My Positions**) and withdraw from Earn products.
2. Swap to USDST as needed on **Trade**.
3. Repay each vault (**Repay** or **Repay All USDST**). Partial repays can't leave debt below the debt floor.
4. Withdraw collateral from each vault.
5. Bridge out if needed (**Bridge Out**). See [Exit Strategy](withdrawals.md) and the [Bridge Guide](../guides/bridge.md).

---

## Next Steps

- **[Portfolio Rebalancing](portfolio-rebalancing.md)** - Maintain allocations
- **[Collateral Optimization](collateral-optimization.md)** - Decide which vaults carry debt
- **[Maximize Yield](maximize-yield.md)** - Focus on income
- **[Risk Management](risk-hedging.md)** · **[Safety Guide](../safety.md)**

### Need Help?

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
