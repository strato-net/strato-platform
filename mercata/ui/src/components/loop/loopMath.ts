// CDP math helpers shared across the loop UI. Kept framework-free so each
// formula lives in exactly one place.

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

// Convert collateralization ratio (e.g. 155%) to LTV ratio (e.g. 0.645).
export const ltvFromCR = (rawRatio: number): number => {
  if (rawRatio <= 0) return 0;
  return rawRatio > 1 ? 1 / (rawRatio / 100) : rawRatio;
};

// Hard max leverage achievable at the given minCR, rounded to 1 decimal.
// Capped at 10x to match the backend validator limit.
export const MAX_LEVERAGE = 10;

export const maxLeverageFromMinCR = (minCR: number): number => {
  if (minCR <= 100) return MAX_LEVERAGE;
  return Math.min(Math.round((1 / (1 - 100 / minCR)) * 10) / 10, MAX_LEVERAGE);
};

// Health factor at the given leverage — how far above liquidation LTV.
export const healthFactorAtLeverage = (leverage: number, liquidationLtv: number): number => {
  if (leverage <= 1 || liquidationLtv <= 0) return 0;
  const lev_ltv = (leverage - 1) / leverage;
  return round2(liquidationLtv / lev_ltv);
};

// Health factor below this threshold is styled as a warning (amber).
export const HEALTH_FACTOR_WARNING = 1.5;

export const healthFactorColor = (hf: number): string =>
  hf > 0 && hf < HEALTH_FACTOR_WARNING ? "text-amber-500" : "text-emerald-500";

// Net carry APR at the given leverage — interest-rate spread only.
// Assumes the user holds the loop; swap fees are one-time entry costs, not
// annualized drags, so they're excluded from the ongoing APR.
export const netCarryAPR = (
  leverage: number,
  baseYieldAPR: number,
  borrowRateAPR: number,
): number => {
  if (leverage <= 1) return 0;
  return round3(leverage * baseYieldAPR - (leverage - 1) * borrowRateAPR);
};
