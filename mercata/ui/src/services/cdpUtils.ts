import { parseUnits, formatUnits } from "ethers";

// Constants for fixed-point arithmetic (matches contract)
export const RAY = BigInt(10) ** BigInt(27);
export const WAD = BigInt(10) ** BigInt(18);
export const INF = BigInt(2) ** BigInt(255);

// Time constants
export const SECONDS_PER_DAY = 86400n;
export const SECONDS_PER_WEEK = 604800n;
export const SECONDS_PER_MONTH = 2592000n; // 30 days
export const SECONDS_PER_YEAR = 31536000n; // 365 days

/**
 * Fixed-point exponentiation (matches contract's _rpow)
 * Computes x^n in RAY precision
 */
export function rpow(x: bigint, n: bigint, ray: bigint = RAY): bigint {
  let z = n % 2n !== 0n ? x : ray;
  let xCopy = x;
  let nCopy = n;
  for (nCopy = nCopy / 2n; nCopy !== 0n; nCopy = nCopy / 2n) {
    xCopy = (xCopy * xCopy) / ray;
    if (nCopy % 2n !== 0n) {
      z = (z * xCopy) / ray;
    }
  }
  return z;
}

/**
 * Convert annual percentage (e.g., 2.8 for 2.8% APR) to per-second RAY rate
 * Target: (1 + annualPercentage/100) = (1 + rate)^secondsPerYear
 * So: rate = (1 + annualPercentage/100)^(1/secondsPerYear) - 1
 * In RAY: targetFactor = RAY + (annualPercentage/100) * RAY
 */
export function convertAnnualPercentageToPerSecondRate(annualPercentage: number): bigint {
  const targetAnnualFactorRay = RAY + BigInt(Math.floor((annualPercentage / 100) * Number(RAY)));
  
  // Binary search for per-second rate
  let low = RAY;
  let high = RAY + (RAY / 100n);
  
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2n;
    const result = rpow(mid, SECONDS_PER_YEAR);
    
    if (result < targetAnnualFactorRay) {
      low = mid;
    } else {
      high = mid;
    }
    
    if (high - low <= 1n) {
      break;
    }
  }
  
  const lowResult = rpow(low, SECONDS_PER_YEAR);
  const highResult = rpow(high, SECONDS_PER_YEAR);
  const lowDiff = lowResult > targetAnnualFactorRay ? lowResult - targetAnnualFactorRay : targetAnnualFactorRay - lowResult;
  const highDiff = highResult > targetAnnualFactorRay ? highResult - targetAnnualFactorRay : targetAnnualFactorRay - highResult;
  
  return lowDiff < highDiff ? low : high;
}

/**
 * Calculate compound interest (matches contract's per-second compounding)
 * @param debtUSD - Debt amount in USD
 * @param annualPercentage - Annual percentage rate (e.g., 2.8 for 2.8%)
 * @param seconds - Number of seconds to compound
 * @returns Interest amount in USD
 */
export function getCompoundInterest(
  debtUSD: number,
  annualPercentage: number,
  seconds: bigint
): number {
  if (debtUSD <= 0 || annualPercentage <= 0) return 0;
  
  const debtWei = parseUnits(debtUSD.toFixed(18), 18);
  const perSecondRate = convertAnnualPercentageToPerSecondRate(annualPercentage);
  const factor = rpow(perSecondRate, seconds);
  const interestWei = (debtWei * (factor - RAY)) / RAY;
  
  return parseFloat(formatUnits(interestWei, 18));
}

// ============================================================================
// Address Utilities
// ============================================================================

/**
 * USDST token address (cannot be used as collateral)
 */
export const USDST_ADDRESS = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";


// ============================================================================
// Collateralization Ratio Calculations
// ============================================================================

/**
 * Compute target collateralization ratio (CR) from minimum CR and risk factor
 * @param minCRWad - Minimum CR in WAD format (e.g., 200% = 2e18)
 * @param riskFactor - Risk factor to apply (e.g., 1.2 for 20% buffer)
 * @returns Target CR in WAD format
 */
export function computeTargetCRWadFromRiskFactor(minCRWad: bigint, riskFactor: number): bigint {
  const riskFactorWad = BigInt(Math.floor(riskFactor * 1000));
  return (minCRWad * riskFactorWad) / 1000n;
}

// ============================================================================
// Debt Calculations
// ============================================================================

/**
 * Compute current debt in USD from scaled debt and rate accumulator
 * @param userVaultScaledDebt - User's scaled debt (wei format)
 * @param rateAccumulatorRay - Current rate accumulator (RAY format)
 * @returns Current debt in USD (wei format, 18 decimals)
 */
export function computeCurrentDebtUSD(
  userVaultScaledDebt: bigint,
  rateAccumulatorRay: bigint
): bigint {
  return (userVaultScaledDebt * rateAccumulatorRay) / RAY;
}

/**
 * Compute global debt in USD from total scaled debt and rate accumulator
 * @param totalScaledDebt - Total scaled debt across all vaults (wei format)
 * @param rateAccumulatorRay - Current rate accumulator (RAY format)
 * @returns Global debt in USD (wei format, 18 decimals)
 */
export function computeGlobalDebtUSD(
  totalScaledDebt: bigint,
  rateAccumulatorRay: bigint
): bigint {
  return (totalScaledDebt * rateAccumulatorRay) / RAY;
}

// ============================================================================
// Collateral Calculations
// ============================================================================

/**
 * Compute collateral value in USD
 * @param collateralAmount - Collateral amount (wei format)
 * @param oraclePrice - Oracle price (wei format, 18 decimals)
 * @param unitScale - Unit scale factor (wei format, typically WAD)
 * @returns Collateral value in USD (wei format, 18 decimals)
 */
export function computeCollateralUSD(
  collateralAmount: bigint,
  oraclePrice: bigint,
  unitScale: bigint
): bigint {
  if (unitScale === 0n) return 0n;
  return (collateralAmount * oraclePrice) / unitScale;
}

/**
 * Compute required collateral amount for a given debt and target CR
 * @param newDebtUSD - New debt amount in USD (wei format, 18 decimals)
 * @param targetCRWad - Target collateralization ratio in WAD format
 * @param oraclePrice - Oracle price (wei format, 18 decimals)
 * @param unitScale - Unit scale factor (wei format, typically WAD)
 * @returns Required collateral amount (wei format)
 */
export function computeRequiredCollateralForCR(
  newDebtUSD: bigint,
  targetCRWad: bigint,
  oraclePrice: bigint,
  unitScale: bigint
): bigint {
  const collateralUSDRequired = (newDebtUSD * targetCRWad) / WAD;
  return (collateralUSDRequired * unitScale) / oraclePrice;
}
