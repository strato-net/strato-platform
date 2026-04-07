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
 * Convert per-second RAY rate to annual percentage (reverse of convertAnnualPercentageToPerSecondRate)
 * Formula: annualFactor = rate^secondsPerYear
 * Annual percentage = (annualFactor - 1) * 100
 * @param stabilityFeeRateRay - Per-second rate in RAY format (e.g., 1.000000088e27 for ~2.8% APR)
 * @returns Annual percentage (e.g., 2.8 for 2.8% APR)
 */
export function convertStabilityFeeRateToAnnualPercentage(stabilityFeeRateRay: bigint): number {
  // Edge case: if rate is exactly RAY (0% APR), return 0
  if (stabilityFeeRateRay <= RAY) return 0;
  
  // Edge case: if rate is too high, cap to prevent overflow
  // Max reasonable APR is ~1000% (rate ~1.00000033 per second)
  const MAX_REASONABLE_RATE = RAY + (RAY / 300000n); // ~100% APR
  const cappedRate = stabilityFeeRateRay > MAX_REASONABLE_RATE ? MAX_REASONABLE_RATE : stabilityFeeRateRay;
  
  const annualFactorRay = rpow(cappedRate, SECONDS_PER_YEAR);
  const factorMinusOne = annualFactorRay - RAY;
  const integerPart = factorMinusOne / RAY;
  const remainder = factorMinusOne % RAY;
  const PRECISION_SCALE = BigInt(1e18);
  const fractionalPart = (remainder * PRECISION_SCALE) / RAY;
  const annualPercentage = (Number(integerPart) + Number(fractionalPart) / Number(PRECISION_SCALE)) * 100;
  
  // Ensure result is finite
  return isFinite(annualPercentage) ? annualPercentage : 0;
}

/**
 * Convert annual percentage (e.g., 2.8 for 2.8% APR) to per-second RAY rate
 * Target: (1 + annualPercentage/100) = (1 + rate)^secondsPerYear
 * So: rate = (1 + annualPercentage/100)^(1/secondsPerYear) - 1
 * In RAY: targetFactor = RAY + (annualPercentage/100) * RAY
 */
export function convertAnnualPercentageToPerSecondRate(annualPercentage: number): bigint {
  // Validate input
  if (!isFinite(annualPercentage) || annualPercentage <= 0) return RAY;
  
  // Calculate target factor: (1 + annualPercentage/100) * RAY
  // Avoid precision loss by using BigInt arithmetic
  const percentageScaled = BigInt(Math.floor(annualPercentage * 1e9)); // Scale to 9 decimal places
  const targetAnnualFactorRay = RAY + (RAY * percentageScaled) / BigInt(1e9) / 100n;
  
  // Binary search for per-second rate
  // Initial bounds: RAY (0% APR) to RAY * 1.01 (1% per-second, ~infinite APR)
  let low = RAY;
  let high = RAY + (RAY / 100n);
  
  // Expand upper bound if target is very high
  if (annualPercentage > 100) {
    high = RAY + (RAY * BigInt(Math.floor(annualPercentage)) / 10000n);
  }
  
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
  
  // Choose the rate closest to target
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
  // Edge case checks
  if (!isFinite(debtUSD) || debtUSD <= 0) return 0;
  if (!isFinite(annualPercentage) || annualPercentage <= 0) return 0;
  if (seconds <= 0n) return 0;
  
  const debtWei = parseUnits(debtUSD.toFixed(18), 18);
  const perSecondRate = convertAnnualPercentageToPerSecondRate(annualPercentage);
  const factor = rpow(perSecondRate, seconds);
  const interestWei = (debtWei * (factor - RAY)) / RAY;
  
  const result = parseFloat(formatUnits(interestWei, 18));
  return isFinite(result) ? result : 0;
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
 * Compute target collateralization ratio (CR) from liquidation ratio and target HF (riskBuffer)
 * This ensures the resulting HF matches the slider value.
 * 
 * Formula: targetCR = liquidationRatio * targetHF
 * Result: HF = CR / liquidationRatio = targetHF ✓
 * 
 * We also ensure targetCR >= minCR to pass on-chain validation.
 * 
 * @param minCRWad - Minimum CR in WAD format (e.g., 200% = 2e18)
 * @param riskBuffer - Target health factor (e.g., 1.13 for HF of 1.13)
 * @param liquidationRatioWad - Liquidation ratio in WAD format (optional, for backward compat)
 * @returns Target CR in WAD format
 */
export function computeTargetCRWadFromRiskBuffer(
  minCRWad: bigint, 
  riskBuffer: number,
  liquidationRatioWad?: bigint
): bigint {
  const riskBufferWad = BigInt(Math.floor(riskBuffer * 1000));
  
  // If liquidationRatio provided, compute CR to achieve target HF
  // targetCR = liquidationRatio * targetHF, but must be >= minCR
  if (liquidationRatioWad !== undefined && liquidationRatioWad > 0n) {
    const targetCRFromHF = (liquidationRatioWad * riskBufferWad) / 1000n;
    // Ensure we don't go below minCR (would fail on-chain)
    return targetCRFromHF > minCRWad ? targetCRFromHF : minCRWad;
  }
  
  // Fallback to old behavior if liquidationRatio not provided
  return (minCRWad * riskBufferWad) / 1000n;
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
