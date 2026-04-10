## Lending

Purpose: Single-asset lending market for USDST with interest and mToken.

Functional summary:
- Deposit/withdraw USDST and earn yield via rising exchange rate.
- Borrow/repay against collateral; protocol accrues interest via index.
- Handle shortfalls with SafetyModule coverage, reserves write‑offs, or haircuts.

Key contracts:
- LendingPool.sol: User actions (deposit/withdraw/borrow/repay) and accounting.
- LiquidityPool.sol: Holds underlying cash and interacts with borrow index.
- LendingRegistry.sol: Addresses/config; links borrowable, mToken, oracle.
- PriceOracle.sol: Provides asset prices (1e18 USD).
- RateStrategy.sol: Interest rate model; borrow and reserve factors.
- CollateralVault.sol: Custody for collateral assets.
- SafetyModule.sol: Risk controls and safety operations.
- PoolConfigurator.sol: Admin configuration.

Core flows:
- Deposit: User supplies USDST → mUSDST minted; exchange rate increases as interest accrues.
- Withdraw: Burn mUSDST → receive USDST, limited by pool cash.
- Borrow/Repay: Debt increases/decreases per interest index; collateralized by supported assets.

Bad debt and shortfall handling:
- Recognition (automatic or manual): liquidation or `recognizeBadDebt` increments `badDebt` when no collateral remains.
- Coverage priority: SafetyModule `coverShortfall` → `writeOffBadDebtFromReserves` → `writeOffBadDebtWithHaircut`.
- Exchange rate uses `underlying = cash + totalDebt + badDebt − reservesAccrued` and updates on each operation.

Formulas:
- Index debt: `debt = scaledDebt × borrowIndex / 1e27`.
- Exchange rate: `rate = (cash + totalDebt + badDebt − reservesAccrued) × 1e18 / mTokenSupply` (1e18 when supply=0).
- Mint mTokens: `mMint = deposit × 1e18 / rate`.
- Burn mTokens for withdraw A: `mBurn = ceil( A × 1e18 / rate )`.
- Health factor: `HF = (Σ collateralAmount_i × price_i × liqThreshold_i / 10000) × 1e18 / (debt × priceBorrow)`.
- Max borrow power: `Σ (collateralAmount_i × price_i × LTV_i / 10000) / priceBorrow`.
- Utilization: `U = debt / (cash + debt − reservesAccrued)`.
- Interest accrual: `borrowIndex_t1 = borrowIndex_t0 × rpow(perSecondFactorRAY, Δt, 1e27) / 1e27`.

SafetyModule formulas:
- `smRate = totalAssets × 1e18 / totalShares` (1e18 when shares=0).
- Preview stake: `sharesOut ≈ (shares==0) ? assetsIn : assetsIn × totalShares / totalAssets`.
- Preview redeem: `assetsOut = sharesIn × totalAssets / totalShares`.
- Slash cap per event: `maxSlash = totalAssets × MAX_SLASH_BPS / 10000`.
- Covered amount: `covered = min(request, totalAssets, maxSlash, lendingPool.badDebt)`.


