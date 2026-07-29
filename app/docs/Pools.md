## Pools (AMM)

Purpose: Constant-product swap pools with dual and single-sided liquidity (zap).

Functional summary:
- Swap tokens via constant‑product pricing with fees.
- Add/remove liquidity proportionally; single‑sided zap balances internally.

Key contracts:
- Pool.sol: AMM logic, swaps, add/remove liquidity, single-sided zap.
- PoolFactory.sol: Creates and configures pools; sets fees and LP share.

Core flows:
- Swap: Input less fee → output via xy=k pricing.
- Add liquidity: Proportional deposit; LP minted. Single-sided uses internal swap to balance.
- Remove liquidity: Burn LP for proportional underlying.

Formulas:
- Constant product: `x × y = k` (reserves before fees).
- Swap output (Uniswap v2-style):
  - `amountInWithFee = amountIn × (10000 − feeBps) / 10000`
  - `amountOut = reserveOut × amountInWithFee / (reserveIn + amountInWithFee)`
- LP mint (proportional): `liquidity = min( amountA × totalSupply / reserveA, amountB × totalSupply / reserveB )`.
- Single-sided optimal internal swap (zap): implementation computes `swapAmt` from reserves, amountIn, and fee to minimize imbalance.


