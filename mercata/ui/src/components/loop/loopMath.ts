// CDP math helpers shared across the loop UI. Framework-free; each formula
// lives in exactly one place.

const MAX_LEVERAGE = 10; // matches backend validator limit
const HEALTH_FACTOR_WARNING = 1.5;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface LoopProjection {
  finalCollateralTokens: number;
  finalCollateralUsd: number;
  finalDebtUsd: number;
  finalLeverage: number;
  finalLtv: number;
  newDebtUsd: number;
}

const ZERO_PROJECTION: LoopProjection = {
  finalCollateralTokens: 0,
  finalCollateralUsd: 0,
  finalDebtUsd: 0,
  finalLeverage: 0,
  finalLtv: 0,
  newDebtUsd: 0,
};

// ─── Ratios ───────────────────────────────────────────────────────

export const ltvFromCR = (rawRatio: number): number => {
  if (rawRatio <= 0) return 0;
  return rawRatio > 1 ? 1 / (rawRatio / 100) : rawRatio;
};

// ─── Leverage ─────────────────────────────────────────────────────

export const maxLeverageFromMinCR = (minCR: number): number => {
  if (minCR <= 100) return MAX_LEVERAGE;
  return Math.min(Math.round((1 / (1 - 100 / minCR)) * 10) / 10, MAX_LEVERAGE);
};

// Smallest target leverage `leverageUp` can deliver given the current position.
// Rounds to the next 0.1 slider step so the result is a valid slider position.
export const minTargetLeverage = (currentLev: number): number => {
  if (currentLev <= 0) return 1.1;
  return Math.max(1.1, Math.round((currentLev + 0.1) * 10) / 10);
};

// ─── Health ───────────────────────────────────────────────────────

export const healthFactorAtLeverage = (leverage: number, liquidationLtv: number): number => {
  if (leverage <= 1 || liquidationLtv <= 0) return 0;
  return round2(liquidationLtv / ((leverage - 1) / leverage));
};

export const healthFactorColor = (hf: number): string =>
  hf > 0 && hf < HEALTH_FACTOR_WARNING ? "text-amber-500" : "text-emerald-500";

// ─── APR ──────────────────────────────────────────────────────────

// Interest-rate spread only; swap fees are one-time entry costs, not drag.
export const netCarryAPR = (
  leverage: number,
  baseYieldAPR: number,
  borrowRateAPR: number,
): number => {
  if (leverage <= 1) return 0;
  return round3(leverage * baseYieldAPR - (leverage - 1) * borrowRateAPR);
};

// ─── Projection ───────────────────────────────────────────────────

// Flat-price (no pool impact); on-chain result deviates ~0.1% due to swap fees.
export const projectLoopedPosition = (args: {
  currentCollateralTokens: number;
  currentDebtUsd: number;
  addPrincipalTokens: number;
  targetLeverage: number;
  priceUsd: number;
}): LoopProjection => {
  const { currentCollateralTokens, currentDebtUsd, addPrincipalTokens, targetLeverage, priceUsd } = args;
  if (targetLeverage <= 1 || priceUsd <= 0) return ZERO_PROJECTION;

  const baseCollUsd = (currentCollateralTokens + addPrincipalTokens) * priceUsd;
  const equity = baseCollUsd - currentDebtUsd;
  if (equity <= 0) return ZERO_PROJECTION;

  const finalCollateralUsd = targetLeverage * equity;
  // `leverageUp` can only add debt; refuse to display a feasible projection
  // when the requested target would require removing debt.
  if (finalCollateralUsd <= baseCollUsd) return ZERO_PROJECTION;
  const newDebtUsd = finalCollateralUsd - baseCollUsd;
  const finalDebtUsd = currentDebtUsd + newDebtUsd;

  return {
    finalCollateralTokens: finalCollateralUsd / priceUsd,
    finalCollateralUsd,
    finalDebtUsd,
    finalLeverage: round2(targetLeverage),
    finalLtv: finalDebtUsd / finalCollateralUsd,
    newDebtUsd,
  };
};
