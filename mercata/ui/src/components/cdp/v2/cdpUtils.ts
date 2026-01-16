import { formatUnits } from 'ethers';
import { formatNumberWithCommas, parseUnitsWithTruncation } from '@/utils/numberUtils';
import type { VaultCandidate, Allocation } from '@/components/cdp/v2/cdpTypes';

// ============================================================================
// Constants
// ============================================================================

// Fixed-point arithmetic constants
export const RAY = 10n ** 27n;
export const WAD = 10n ** 18n;
export const INF = 2n ** 255n;

// Fee constants
export const DEPOSIT_FEE_USDST = 0.02;
export const MINT_FEE_USDST = 0.01;
export const SAFETY_BUFFER_BPS = 5n;
export const BPS_SCALE = 10000n;

// Time constants
export const SECONDS_PER_YEAR = 31536000n;

// ============================================================================
// Stability Fee Rate Conversion
// ============================================================================

/**
 * Fixed-point exponentiation (matches contract's _rpow)
 * Computes x^n in RAY precision
 */
function rpow(x: bigint, n: bigint, ray: bigint = RAY): bigint {
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
 * Convert per-second RAY rate to annual percentage
 * @param stabilityFeeRateRay - Per-second rate in RAY format
 * @returns Annual percentage (e.g., 2.8 for 2.8% APR)
 */
export function convertStabilityFeeRateToAnnualPercentage(stabilityFeeRateRay: bigint): number {
  if (stabilityFeeRateRay <= RAY) return 0;
  
  const MAX_REASONABLE_RATE = RAY + (RAY / 300000n);
  const cappedRate = stabilityFeeRateRay > MAX_REASONABLE_RATE ? MAX_REASONABLE_RATE : stabilityFeeRateRay;
  
  const annualFactorRay = rpow(cappedRate, SECONDS_PER_YEAR);
  const factorMinusOne = annualFactorRay - RAY;
  const integerPart = factorMinusOne / RAY;
  const remainder = factorMinusOne % RAY;
  const PRECISION_SCALE = BigInt(1e18);
  const fractionalPart = (remainder * PRECISION_SCALE) / RAY;
  const annualPercentage = (Number(integerPart) + Number(fractionalPart) / Number(PRECISION_SCALE)) * 100;
  
  return isFinite(annualPercentage) ? annualPercentage : 0;
}

// ============================================================================
// Target CR and HF Calculations
// ============================================================================

/**
 * Compute target collateralization ratio (CR) from target health factor
 * 
 * Formula: targetCR = liquidationRatio * targetHF
 * Result: HF = CR / liquidationRatio = targetHF ✓
 * 
 * Ensures targetCR >= minCR to pass on-chain validation.
 * 
 * @param minCRWad - Minimum CR in WAD format (e.g., 1.5e18 for 150%)
 * @param targetHF - Target health factor (e.g., 1.13)
 * @param liquidationRatioWad - Liquidation ratio in WAD format (e.g., 1.33e18 for 133%)
 * @returns Target CR in WAD format
 */
export function computeTargetCRFromHF(
  minCRWad: bigint, 
  targetHF: number,
  liquidationRatioWad: bigint
): bigint {
  // Use high precision (1e12) to minimize floating-point rounding errors
  const PRECISION = 1000000000000n; // 1e12
  const targetHFScaled = BigInt(Math.round(targetHF * 1e12));
  
  // targetCR = liquidationRatio * targetHF
  const targetCRFromHF = (liquidationRatioWad * targetHFScaled) / PRECISION;
  
  // Calculate the theoretical minimum HF using pure BigInt math: minHF = minCR / liquidationRatio
  // If targetHF is at or below this minimum, return minCR exactly (avoids rounding issues)
  // minHF * PRECISION = (minCR * PRECISION) / liquidationRatio
  const minHFScaled = (minCRWad * PRECISION) / liquidationRatioWad;
  
  // If targetHF is at or very close to minimum (within 0.01%), snap to minCR
  // This handles floating-point imprecision from the slider
  const tolerance = minHFScaled / 10000n; // 0.01%
  if (targetHFScaled <= minHFScaled + tolerance) {
    return minCRWad;
  }
  
  // Ensure we don't go below minCR (would fail on-chain)
  return targetCRFromHF > minCRWad ? targetCRFromHF : minCRWad;
}

// ============================================================================
// Collateral Calculations
// ============================================================================

/**
 * Compute collateral value in USD
 * @param collateralAmount - Collateral amount in native units
 * @param oraclePrice - Oracle price (18 decimals)
 * @param assetScale - Asset scale (10^decimals, e.g., 1e18 for 18-decimal tokens)
 * @returns Collateral value in USD (18 decimals)
 */
export function computeCollateralValueUSD(
  collateralAmount: bigint,
  oraclePrice: bigint,
  assetScale: bigint
): bigint {
  if (assetScale === 0n) return 0n;
  return (collateralAmount * oraclePrice) / assetScale;
}

/**
 * Compute required collateral amount for a given debt and target CR
 * @param debtUSD - Debt amount in USD (18 decimals)
 * @param targetCRWad - Target collateralization ratio in WAD format
 * @param oraclePrice - Oracle price (18 decimals)
 * @param assetScale - Asset scale (10^decimals)
 * @returns Required collateral amount in native units
 */
export function computeRequiredCollateralForCR(
  debtUSD: bigint,
  targetCRWad: bigint,
  oraclePrice: bigint,
  assetScale: bigint
): bigint {
  if (oraclePrice === 0n) return 0n;
  const collateralUSDRequired = (debtUSD * targetCRWad) / WAD;
  return (collateralUSDRequired * assetScale) / oraclePrice;
}

/**
 * Compute maximum mintable debt for given collateral at target HF
 * @param collateralAmount - Collateral amount in native units
 * @param oraclePrice - Oracle price (18 decimals)
 * @param assetScale - Asset scale (10^decimals)
 * @param targetCRWad - Target CR in WAD format
 * @param currentDebt - Current debt (18 decimals)
 * @returns Maximum additional mintable debt (18 decimals)
 */
export function computeMaxMintableDebt(
  collateralAmount: bigint,
  oraclePrice: bigint,
  assetScale: bigint,
  targetCRWad: bigint,
  currentDebt: bigint
): bigint {
  const collateralValueUSD = computeCollateralValueUSD(collateralAmount, oraclePrice, assetScale);
  const maxDebt = (collateralValueUSD * WAD) / targetCRWad;
  return maxDebt > currentDebt ? maxDebt - currentDebt : 0n;
}

// Formatting utilities
export const formatUSD = (value: number, decimals = 2): string =>
  isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '0.00';

export const formatPercentage = (num: number, decimals = 2): string =>
  isNaN(num) ? '0.00%' : num.toFixed(decimals) + '%';

// Risk calculation utilities
export const getRiskColor = (factor: number): string => {
  if (factor <= 1.5) {
    const ratio = (factor - 1.0) / 0.5;
    return `rgb(${Math.round(239 + (16 - 239) * ratio)}, ${Math.round(68 + (185 - 68) * ratio)}, ${Math.round(68 + (129 - 68) * ratio)})`;
  }
  const ratio = (factor - 1.5) / 1.0;
  return `rgb(${Math.round(16 + (180 - 16) * ratio)}, ${Math.round(185 + (220 - 185) * ratio)}, ${Math.round(129 + (180 - 129) * ratio)})`;
};

export const getRiskLabel = (factor: number): string => {
  if (factor >= 2.0) return 'Low Risk';
  if (factor >= 1.5) return 'Moderate Risk';
  return 'High Risk';
};

export const calculateHealthFactor = (cr: number, lt: number): number => {
  return cr / lt;
};

// Input parsing utilities
export const parseInputToWei = (input: string): bigint => {
  const str = (input || '').replace(/,/g, '').trim();
  if (!str || str === '0') return 0n;
  try {
    const [intPart = '', decPart = ''] = str.split('.');
    return BigInt(intPart + decPart.padEnd(18, '0').substring(0, 18));
  } catch {
    return 0n;
  }
};

// Allocation utilities
export function addAllocationsToVaultCandidates(
  allocations: Allocation[],
  candidates: VaultCandidate[]
): VaultCandidate[] {
  const result = allocations
    .map(allocation => {
      const candidate = candidates.find(c => c.vaultConfig.assetAddress === allocation.assetAddress);
      return candidate ? { ...candidate, allocation } : null;
    })
    .filter((item) => item !== null) as VaultCandidate[];
  
  return result.sort((a, b) => {
    const aRate = parseFloat(formatUnits(a.vaultConfig.stabilityFeeRate, 18));
    const bRate = parseFloat(formatUnits(b.vaultConfig.stabilityFeeRate, 18));
    return aRate - bRate;
  });
}

// Fee calculation utilities
export const calculateTransactionCount = (vaultCandidates: VaultCandidate[]): number => {
  return vaultCandidates.reduce((count, v) => {
    const hasDeposit = v.allocation && v.allocation.depositAmount > 0n;
    const hasMint = v.allocation && v.allocation.mintAmount > 0n;
    return count + (hasDeposit ? 1 : 0) + (hasMint ? 1 : 0);
  }, 0);
};

export const calculateTotalFees = (vaultCandidates: VaultCandidate[]): number => {
  return vaultCandidates.reduce((fees, v) => {
    const hasDeposit = v.allocation && v.allocation.depositAmount > 0n;
    const hasMint = v.allocation && v.allocation.mintAmount > 0n;
    return fees + (hasDeposit ? DEPOSIT_FEE_USDST : 0) + (hasMint ? MINT_FEE_USDST : 0);
  }, 0);
};

// Amount calculation utilities
export const calculateTotalMaxMintWei = (vaultCandidates: VaultCandidate[]): bigint => {
  // mintAmount is already in wei format (bigint)
  return vaultCandidates.reduce((sum, v) => {
    return sum + (v.allocation?.mintAmount || 0n);
  }, 0n);
};

export const calculateAvailableToMint = (totalMaxMintWei: bigint): string => {
  if (totalMaxMintWei > 0n) {
    const amount = parseFloat(formatUnits(totalMaxMintWei, 18));
    const rounded = Math.round(amount * 100) / 100; // Round to 2 decimals
    return formatNumberWithCommas(rounded.toFixed(2));
  }
  return '0.00';
};

// APR calculation utilities
export const calculateWeightedAverageAPR = (vaultCandidates: VaultCandidate[]): number => {
  if (vaultCandidates.length === 0) return 0;
  let totalMint = 0, weightedSum = 0;
  
  for (const v of vaultCandidates) {
    if (!v.allocation) continue;
    const mint = parseFloat(formatUnits(v.allocation.mintAmount, 18));
    const feeRate = parseFloat(formatUnits(v.vaultConfig.stabilityFeeRate, 18)) * 100; // Convert to percentage
    if (isFinite(mint) && isFinite(feeRate) && mint > 0 && feeRate >= 0) {
      totalMint += mint;
      weightedSum += mint * feeRate;
    }
  }
  
  const result = totalMint > 0 ? weightedSum / totalMint : 0;
  return isFinite(result) ? result : 0;
};

// Collateral calculation utilities
export const calculateTotalCollateralValue = (
  vaultCandidates: VaultCandidate[]
): number => {
  let total = 0;
  vaultCandidates.forEach(candidate => {
    if (candidate.allocation && candidate.allocation.depositAmount > 0n) {
      // Calculate USD value on-the-fly
      const depositAmountUSD = parseFloat(
        formatUnits((candidate.allocation.depositAmount * candidate.oraclePrice) / candidate.vaultConfig.unitScale, 18)
      );
      total += depositAmountUSD;
    }
  });
  return total;
};

// Position calculation utilities
export interface PositionCalculationResult {
  totalMinted: number;
  weightedAverageFee: number;
  totalCollateralUSD: number;
  overallHealthFactor: number;
}

export const calculatePositionMetrics = (
  positions: Array<{
    debtAmount: string;
    collateralValueUSD: string;
    stabilityFeeRate: number;  // Note: this is decimal percentage, not wei
    liquidationRatio: number;
    collateralizationRatio: number;
  }>,
  formatWeiToDecimalHP: (value: string, decimals: number) => string
): PositionCalculationResult => {
  const totalMinted = positions.reduce((sum, pos) => {
    const debt = parseFloat(formatWeiToDecimalHP(pos.debtAmount, 18));
    return sum + debt;
  }, 0);

  let totalDebt = 0;
  let weightedSum = 0;
  
  positions.forEach(pos => {
    const debt = parseFloat(formatWeiToDecimalHP(pos.debtAmount, 18));
    if (debt > 0) {
      totalDebt += debt;
      weightedSum += debt * pos.stabilityFeeRate;
    }
  });
  
  const weightedAverageFee = totalDebt > 0 ? weightedSum / totalDebt : 0;

  const totalCollateralUSD = positions.reduce((sum, pos) => {
    const collateralUSD = parseFloat(formatWeiToDecimalHP(pos.collateralValueUSD, 18));
    return sum + collateralUSD;
  }, 0);

  if (totalMinted === 0) {
    return {
      totalMinted,
      weightedAverageFee,
      totalCollateralUSD,
      overallHealthFactor: Infinity,
    };
  }
  
  // Calculate weighted average liquidation ratio
  let totalDebtForLT = 0;
  let weightedLT = 0;
  
  positions.forEach(pos => {
    const debt = parseFloat(formatWeiToDecimalHP(pos.debtAmount, 18));
    if (debt > 0) {
      totalDebtForLT += debt;
      weightedLT += debt * pos.liquidationRatio;
    }
  });
  
  if (totalDebtForLT === 0) {
    return {
      totalMinted,
      weightedAverageFee,
      totalCollateralUSD,
      overallHealthFactor: Infinity,
    };
  }
  
  const avgLT = weightedLT / totalDebtForLT;
  const cr = (totalCollateralUSD / totalMinted) * 100;
  
  const overallHealthFactor = cr / avgLT;

  return {
    totalMinted,
    weightedAverageFee,
    totalCollateralUSD,
    overallHealthFactor,
  };
};

/**
 * Calculate aggregate health factor across multiple vaults
 * 
 * Formula: overallHF = aggregateCR / weightedAvgLT
 * Where:
 * - aggregateCR = (totalCollateralUSD / totalDebtUSD) × 100
 * - weightedAvgLT = Σ(debt_i × LT_i) / Σ(debt_i)
 * 
 * This is used consistently across:
 * - DebtPosition.tsx (for current position)
 * - Mint.tsx (for projected position after mint)
 * - Allocation.tsx (for display in vault breakdown)
 * 
 * @param vaults - Array of vault data with collateral, debt, and new deposits/mints
 * @returns Health factor as a formatted string (2 decimal places) or null if no debt
 */
export const calculateAggregateHealthFactor = (
  vaults: Array<{
    currentCollateral: bigint;
    currentDebt: bigint;
    depositAmount: number; // New deposit to add (in token units)
    mintAmount: number; // New mint to add (in USDST)
    oraclePrice: bigint;
    unitScale: bigint;
    liquidationRatio: bigint;
    decimals: number; // Token decimals for parsing deposit
  }>
): string | null => {
  let totalCollateralUSD = 0;
  let totalDebtUSD = 0;
  let weightedLTSum = 0;
  
  for (const vault of vaults) {
    // Calculate total debt for this vault (existing + new mint)
    // Use parseUnitsWithTruncation to handle amounts with too many decimal places
    const mintWei = vault.mintAmount > 0 ? parseUnitsWithTruncation(vault.mintAmount.toString(), 18) : 0n;
    const totalDebt = vault.currentDebt + mintWei;
    
    // Skip vaults with zero debt (they have infinite HF)
    if (totalDebt <= 0n) continue;

    // Calculate total collateral (existing + new deposit)
    // Use parseUnitsWithTruncation to handle amounts with too many decimal places
    const depositWei = vault.depositAmount > 0 ? parseUnitsWithTruncation(vault.depositAmount.toString(), vault.decimals) : 0n;
    const totalCollateral = vault.currentCollateral + depositWei;
    
    // Calculate collateral value in USD
    const collateralValueUSD = (totalCollateral * vault.oraclePrice) / vault.unitScale;
    const collateralUSD = parseFloat(formatUnits(collateralValueUSD, 18));
    const debtUSD = parseFloat(formatUnits(totalDebt, 18));
    
    // Liquidation ratio as percentage (e.g., 1.33e18 -> 133)
    const lt = parseFloat(formatUnits(vault.liquidationRatio, 18)) * 100;
    
    // Accumulate totals for aggregate calculation
    totalCollateralUSD += collateralUSD;
    totalDebtUSD += debtUSD;
    weightedLTSum += debtUSD * lt;
  }

  // Need at least some debt to calculate HF
  if (totalDebtUSD <= 0) return null;

  // Calculate weighted average liquidation threshold
  const weightedAvgLT = weightedLTSum / totalDebtUSD;
  
  // Calculate aggregate collateralization ratio
  const aggregateCR = (totalCollateralUSD / totalDebtUSD) * 100;
  
  // Calculate overall health factor
  const overallHF = aggregateCR / weightedAvgLT;
  
  if (!isFinite(overallHF) || isNaN(overallHF)) return null;
  
  return overallHF.toFixed(2);
};

// Asset utilities
export const getAssetColor = (symbol: string): string => {
  const colors: Record<string, string> = {
    'ETHST': '#3b82f6', // blue
    'PAXGST': '#fbbf24', // yellow/amber
    'BTCST': '#f59e0b', // orange
  };
  return colors[symbol] || '#6b7280'; // default gray
};

// ============================================================================
// Health Factor Slider Utilities
// ============================================================================

/**
 * Calculate the minimum health factor for the HF slider based on vault data
 * 
 * Formula: minHF = max(minCR across all vaults) / max(liquidationRatio across all vaults)
 * 
 * @param vaultCandidates - Array of vault candidates with minCR and liquidationRatio in WAD format
 * @returns Minimum health factor for slider (typically around 1.0-1.5)
 */
export const calculateSliderMinHF = (
  vaultCandidates: VaultCandidate[]
): number => {
  if (vaultCandidates.length === 0) return 1.0;
  
  // Find max minCR from all vault candidates (minCR is in WAD format)
  const maxMinCRWad = vaultCandidates.reduce((max, v) => v.vaultConfig.minCR > max ? v.vaultConfig.minCR : max, 0n);
  const maxMinCRPercent = Number(maxMinCRWad) / Number(WAD) * 100; // Convert to percentage
  
  // Find max liquidation ratio from all vault candidates (liquidationRatio is in WAD format)
  const maxLRWad = vaultCandidates.reduce((max, v) => v.vaultConfig.liquidationRatio > max ? v.vaultConfig.liquidationRatio : max, 0n);
  const maxLT = Number(maxLRWad) / Number(WAD) * 100; // Convert to percentage
  
  if (maxLT <= 0) return 1.0;
  
  // minHF = max(minCR) / max(LT)
  // e.g., 150% / 133% = 1.13
  const minHF = maxMinCRPercent / maxLT;
  
  // Round to 2 decimal places
  const roundedMinHF = Math.round(minHF * 100) / 100;
  
  return roundedMinHF;
};

/**
 * Calculate minimum HF from percentage values directly
 * Use this when you have minCR and liquidationRatio as percentage numbers
 * 
 * @param minCRs - Array of minimum collateralization ratios as percentages (e.g., 150 for 150%)
 * @param liquidationRatios - Array of liquidation ratios as percentages (e.g., 133 for 133%)
 * @returns Minimum health factor for slider
 */
export const calculateSliderMinHFFromPercentages = (
  minCRs: number[],
  liquidationRatios: number[]
): number => {
  if (minCRs.length === 0 || liquidationRatios.length === 0) return 1.0;
  
  const maxMinCR = Math.max(...minCRs);
  const maxLT = Math.max(...liquidationRatios);
  
  if (maxLT <= 0) return 1.0;
  
  const minHF = maxMinCR / maxLT;
  
  const roundedMinHF = Math.round((maxMinCR / maxLT) * 100) / 100;
  
  return roundedMinHF;
};

