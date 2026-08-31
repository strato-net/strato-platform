# Lending Pool Functional Overview

## Constants and Units

- RAY = `1e27`; SECONDS_PER_YEAR = `31,536,000`
- Prices and USD values use `1e18` scale; basis points use `10000 = 100%`

## One Borrowable Asset

- Exactly one `borrowableAsset` per pool.
- Suppliers deposit this asset and receive `mToken`.
- Borrowers always borrow/repay in this same asset.
- Multiple collateral assets supported; each with: `ltv`, `liquidationThreshold`, `liquidationBonus`, `interestRate`, `reserveFactor`.

## Global Borrow Index (Compound Accrual)

- Per-second compound base in RAY: `perSecondFactorRAY` (e.g., `(1+APR)^(1/SECONDS_PER_YEAR)` scaled by `1e27`).
- Index update over `dt` seconds: `idx_next = idx_current * rpow(perSecondFactorRAY, dt, RAY) / RAY`
- Weekly/daily/block steps multiply the index; debt compounds discretely as the index grows.
- Persisted only when `_accrue()` runs on state-changing calls (borrow/repay/deposit/withdraw/collateral ops/config). Read-only helpers never write state.
- Interest routed to protocol reserves when there is debt:
  - `interestDelta = (totalScaledDebt * (idx1 - idx0)) / RAY`
  - `reservesAccrued += (interestDelta * reserveFactorBps) / 10000`

## User/System Debt (Index-Based)

- User debt at read time: `debt_user = (scaledDebt_user * borrowIndex) / RAY`
- System debt: `totalDebt = (totalScaledDebt * borrowIndex) / RAY`

## Liquidity Providers and mToken Exchange Rate

- Supplier-claimable underlying excludes protocol reserves (floored at cash if negative): `underlying = cash + totalDebt - reservesAccrued`
- Exchange rate (1e18 = 1 underlying per mToken): `exchangeRate = (underlying * 1e18) / mTokenTotalSupply`

## Collateral Valuation and Health

- Effective collateral USD per asset (using liquidation threshold): `USD_i = (amount_i * price_i * liqThreshBps_i) / (1e18 * 10000)`
- Totals and health factor:
  - `collatUSD = sum_i USD_i`
  - `borrowUSD = (debt * price_borrow) / 1e18`
  - `HF = collatUSD / borrowUSD`

## Max Borrowing Power (Capacity)

- Per-asset borrowable USD (LTV-based): `borrowableUSD_i = (amount_i * price_i * LTVbps_i) / (1e18 * 10000)`
- Pool max in borrow units:
  - `totalBorrowableUSD = sum_i borrowableUSD_i`
  - `maxBorrowAmount = (totalBorrowableUSD * 1e18) / price_borrow`

## Borrow

- Borrow exact amount A: scaled increment and update (enforcing ceilings): `Δscaled = (A * RAY) / borrowIndex`
- Borrow max (on-chain helper):
  - `available = maxBorrowAmount - currentOwed`
  - `amountBorrow = max(available - 1, 0)`  (1 wei safety)
  - `Δscaled = (amountBorrow * RAY) / borrowIndex`

## Repay

- Repay exact R (bounded by current scaled): `Δscaled = (R * RAY) / borrowIndex`
- Repay all: `amountRepaid = (scaledDebt * borrowIndex) / RAY`
- Dust cleanup: if residual owed `<= 1` wei after reduction, the loan is zeroed to avoid leftover dust.

## Collateral Supply/Withdraw

- Supply: move tokens into `CollateralVault` and increase recorded collateral.
- Withdraw exact W: simulate reduced borrowing power excluding `W`; require `current debt ≤ new max`.
- Withdraw max (with outstanding debt):
  - `roomBorrow = maxBorrowAmount - currentOwed`
  - `amountMaxByHealth = (roomBorrow * price_borrow * 10000) / (price_asset * LTVbps_asset)`
  - `amountWithdrawn = min(amountMaxByHealth, userCollateral)`; if `amountWithdrawn > 1` then `amountWithdrawn -= 1` (1 wei safety)
- Re-check health post-compute before removal.

## Protocol Reserves

- Reserves accrue as a fraction of interest: `Δreserves = (interestDelta * reserveFactorBps) / 10000`
- Reserves are excluded from supplier `underlying` in the exchange-rate.

## System Ceilings (Risk Control)

- Before borrowing a new amount `A`:
  - `(totalDebt + A) <= debtCeilingAsset`
  - `((totalDebt + A) * price_borrow) / 1e18 <= debtCeilingUSD`

## Preview Helpers (Read-Only)

- Index preview at current block time (dt = now - lastAccrual): `previewIndex = (borrowIndex * rpow(perSecondFactorRAY, dt, RAY)) / RAY`
- Debt preview: `debtPreview = (scaledDebt * previewIndex) / RAY` 

## Liquidation

- Close-factor cap based on health:
  - If `HF < 0.95`: up to 100% of outstanding debt
  - Else: up to 50% of outstanding debt
- Coverage cap (selected collateral):
  - Let `bonus = liquidationBonusBps` and prices be 1e18 scaled
  - `coverage = ceil((borrowerCollateral * price_coll * 10000) / (price_borrow * bonus))`
    - where `ceil(x/y) = (x + y - 1) / y`
- Execution amount:
  - If caller provides an amount `R`: `repay = min(R, closeFactorCap)` (legacy call).
  - If caller uses “ALL”: contract computes `repay = min(currentDebt, closeFactorCap, coverage)` at execution time.
- Seizure:
  - `collateralToSeize = (repay * price_borrow * bonus) / (price_coll * 10000)`
  - Then clamped to the borrower’s available collateral for that asset.
- Dust cleanup:
  - After reducing scaled debt, if residual owed `<= 1 wei`, loan is zeroed. 