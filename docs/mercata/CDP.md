## CDP (Collateralized Debt Positions)

Purpose: Borrowing against collateral with risk parameters and liquidation.

Functional summary:
- Mint/burn USDST against supported collateral with per‑asset risk params.
- Liquidate unhealthy vaults via direct seize with penalty and close factor.
- Realize and resolve bad debt; junior note mechanism repays from reserves.

Key contracts:
- CDPEngine.sol: Core debt accounting, interest, and liquidation mechanics.
- CDPRegistry.sol: Registry of system addresses/configuration.
- CDPReserve.sol: Protocol reserve management for CDP.
- CDPVault.sol: Asset custody for collateral and debt settlement.

Core flows:
- Open: Lock collateral → mint debt asset per LTV.
- Accrue: Interest via index; debt grows over time.
- Repay: Burn debt asset to reduce obligation; release collateral.
- Liquidate: If health < threshold, liquidator repays and seizes collateral with bonus.

Accrual and units:
- Per‑asset index `rateAccumulator` (RAY, 1e27). Debt reads use `scaledDebt * rateAccumulator / RAY`.
- `_rpow` computes discrete compounding; accumulator never falls below RAY.
- `unitScale` maps collateral token units to 1e18 when valuing in USD.

Formulas:
- Debt (USD, 18d): `debtUSD = scaledDebt × rateAccumulator / 1e27`.
- Collateral value (USD): `collateralUSD = collateralAmount × price / unitScale`.
- Collateralization ratio: `CR = collateralUSD × 1e18 / debtUSD`.
- Max mint (mintMax headroom): `maxUSD = collateralUSD × 1e18 / liquidationRatio − currentDebtUSD − 1 (wei safety)`.
- Liquidation caps: `closeFactorCap = totalDebtUSD × closeFactorBps / 10000`.
- Coverage cap including penalty: `coverageCap = collateralUSD × 10000 / (10000 + penaltyBps)`.
- Exact burn on liquidate: `owedForDelta = scaledDelta × rateAccumulator / 1e27` (burn this USDST amount).
- Penalty USD: `penaltyUSD = owedForDelta × penaltyBps / 10000`.
- Collateral to seize: `seize = ( (owedForDelta + penaltyUSD) × unitScale ) / priceColl`.
- Junior index bump: `deltaIndex = deltaReserveUSDST × 1e27 / totalJuniorOutstandingUSDST`.
- Junior entitlement: `ent = min( capUSDST, capUSDST × (effectiveIndex − entryIndex) / 1e27 )`.

Liquidation (direct seize, no auction):
- Caps the repay by: totalDebt, `closeFactorBps`, and coverage INCLUDING penalty:
  - `coverageCap = collateralUSD * 10000 / (10000 + liquidationPenaltyBps)`
- Burns EXACT extinguished USD: `owedForDelta = scaledToLiquidate * rateAccumulator / RAY`.
- Routes fee portion (owedForDelta − principal) between `CDPReserve` and `FeeCollector` via `_routeFees` (split by `feeToReserveBps`).
- Seizes collateral for `(repay + penalty)` at oracle price; clamps to borrower collateral.
- Dust handling: if remaining collateral ≤ threshold, it is seized; if no collateral remains and debt > 1 wei, records bad debt (see below).

Bad debt lifecycle (per‑asset):
- Realization: when a vault has zero collateral after liquidation and non‑trivial debt remains, the residual is removed from books and added to `badDebtUSDST[asset]`. Event: `BadDebtRealized(asset, borrower, amount)`.
- Repayment via juniors: `openJuniorNote(asset, amount)` burns caller’s USDST to reduce bad debt (clamped to remaining). A junior note is created with cap = principal × (1 + premiumBps).
- Reserve indexing: new USDST appearing in `CDPReserve` increments a global `juniorIndex` (RAY). Entitlements per note are proportional to cap and index growth; capped at remaining cap.
- Claim: `claimJunior()` pays from `CDPReserve` up to entitlement; reduces note cap and adjusts entry index to preserve unpaid accrual.

Fees and reserves:
- `_routeFees(asset, feeUSD)`: mints USDST fees and splits between `CDPReserve` and `FeeCollector` by `feeToReserveBps`. Event: `FeesRouted`.

Pause controls:
- Per‑asset and global pause switches block actions when set.


