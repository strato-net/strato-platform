import { formatUnits, parseUnits } from 'ethers';
import { formatNumberWithCommas } from '@/utils/numberUtils';
import type { PlanItem } from '@/services/cdpTypes';
import type { VaultCandidate } from '@/services/MintService';

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
  const targetHFScaled = BigInt(Math.floor(targetHF * 1000));
  
  // targetCR = liquidationRatio * targetHF
  const targetCRFromHF = (liquidationRatioWad * targetHFScaled) / 1000n;
  
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

// Allocation conversion utilities
export function allocationToPlanItem(
  allocation: { assetAddress: string; depositAmount: bigint; mintAmount: bigint },
  candidate: VaultCandidate
): PlanItem {
  const decimals = candidate.assetScale.toString().length - 1;
  const depositAmountUSDWei = (allocation.depositAmount * candidate.oraclePrice) / candidate.assetScale;
  const existingCollateralUSDWei = (candidate.currentCollateral * candidate.oraclePrice) / candidate.assetScale;
  const userBalanceUSDWei = (candidate.potentialCollateral * candidate.oraclePrice) / candidate.assetScale;
  
  return {
    assetAddress: allocation.assetAddress,
    symbol: candidate.symbol,
    depositAmount: formatUnits(allocation.depositAmount, decimals),
    depositAmountUSD: formatUnits(depositAmountUSDWei, 18),
    mintAmount: formatUnits(allocation.mintAmount, 18),
    stabilityFeeRate: convertStabilityFeeRateToAnnualPercentage(candidate.stabilityFeeRate),
    existingCollateralUSD: formatUnits(existingCollateralUSDWei, 18),
    userBalance: formatUnits(candidate.potentialCollateral, decimals),
    userBalanceUSD: formatUnits(userBalanceUSDWei, 18),
  };
}

export function convertAllocationsToPlanItems(
  allocations: { assetAddress: string; depositAmount: bigint; mintAmount: bigint }[],
  candidates: VaultCandidate[]
): PlanItem[] {
  return allocations
    .map(allocation => {
      const candidate = candidates.find(c => c.assetAddress === allocation.assetAddress);
      return candidate ? allocationToPlanItem(allocation, candidate) : null;
    })
    .filter((item): item is PlanItem => item !== null)
    .sort((a, b) => a.stabilityFeeRate - b.stabilityFeeRate);
}

// Fee calculation utilities
export const calculateTransactionCount = (optimalAllocations: PlanItem[]): number => {
  return optimalAllocations.reduce((count, a) => {
    const hasDeposit = a.depositAmount && a.depositAmount !== '0' && parseFloat(a.depositAmount) > 0;
    const hasMint = a.mintAmount && a.mintAmount !== '0' && parseFloat(a.mintAmount) > 0;
    return count + (hasDeposit ? 1 : 0) + (hasMint ? 1 : 0);
  }, 0);
};

export const calculateTotalFees = (optimalAllocations: PlanItem[]): number => {
  return optimalAllocations.reduce((fees, a) => {
    const hasDeposit = a.depositAmount && a.depositAmount !== '0' && parseFloat(a.depositAmount) > 0;
    const hasMint = a.mintAmount && a.mintAmount !== '0' && parseFloat(a.mintAmount) > 0;
    return fees + (hasDeposit ? DEPOSIT_FEE_USDST : 0) + (hasMint ? MINT_FEE_USDST : 0);
  }, 0);
};

// Amount calculation utilities
export const calculateTotalMaxMintWei = (maxAllocations: PlanItem[]): bigint => {
  return maxAllocations.reduce((sum, a) => sum + parseUnits(a.mintAmount, 18), 0n);
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
export const calculateWeightedAverageAPR = (optimalAllocations: PlanItem[]): number => {
  if (optimalAllocations.length === 0) return 0;
  let totalMint = 0, weightedSum = 0;
  
  for (const a of optimalAllocations) {
    const mint = parseFloat(a.mintAmount);
    if (isFinite(mint) && isFinite(a.stabilityFeeRate) && mint > 0 && a.stabilityFeeRate >= 0) {
      totalMint += mint;
      weightedSum += mint * a.stabilityFeeRate;
    }
  }
  
  const result = totalMint > 0 ? weightedSum / totalMint : 0;
  return isFinite(result) ? result : 0;
};

// Collateral calculation utilities
export const calculateTotalCollateralValue = (optimalAllocations: PlanItem[]): number => {
  let total = 0;
  optimalAllocations.forEach(alloc => {
    const depositAmount = parseFloat(alloc.depositAmount || '0');
    if (depositAmount > 0) {
      total += parseFloat(alloc.depositAmountUSD || '0');
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
    stabilityFeeRate: number;
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
    assetScale: bigint;
    liquidationRatio: bigint;
    decimals: number; // Token decimals for parsing deposit
  }>
): string | null => {
  let totalCollateralUSD = 0;
  let totalDebtUSD = 0;
  let weightedLTSum = 0;
  
  for (const vault of vaults) {
    // Calculate total debt for this vault (existing + new mint)
    // Round to 18 decimals to avoid "too many decimals" error in parseUnits
    const mintWei = vault.mintAmount > 0 ? parseUnits(vault.mintAmount.toFixed(18), 18) : 0n;
    const totalDebt = vault.currentDebt + mintWei;
    
    // Skip vaults with zero debt (they have infinite HF)
    if (totalDebt <= 0n) continue;

    // Calculate total collateral (existing + new deposit)
    // Round to token decimals to avoid "too many decimals" error in parseUnits
    const depositWei = vault.depositAmount > 0 ? parseUnits(vault.depositAmount.toFixed(vault.decimals), vault.decimals) : 0n;
    const totalCollateral = vault.currentCollateral + depositWei;
    
    // Calculate collateral value in USD
    const collateralValueUSD = (totalCollateral * vault.oraclePrice) / vault.assetScale;
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
  const maxMinCRWad = vaultCandidates.reduce((max, v) => v.minCR > max ? v.minCR : max, 0n);
  const maxMinCRPercent = Number(maxMinCRWad) / Number(WAD) * 100; // Convert to percentage
  
  // Find max liquidation ratio from all vault candidates (liquidationRatio is in WAD format)
  const maxLRWad = vaultCandidates.reduce((max, v) => v.liquidationRatio > max ? v.liquidationRatio : max, 0n);
  const maxLT = Number(maxLRWad) / Number(WAD) * 100; // Convert to percentage
  
  console.log('[calculateSliderMinHF] Vault candidates:', vaultCandidates.length);
  console.log('[calculateSliderMinHF] max(minCR) across all vaults:', maxMinCRPercent, '%');
  console.log('[calculateSliderMinHF] max(liquidationRatio) across all vaults:', maxLT, '%');
  
  if (maxLT <= 0) return 1.0;
  
  // minHF = max(minCR) / max(LT)
  // e.g., 150% / 133% = 1.13
  const minHF = maxMinCRPercent / maxLT;
  
  console.log('[calculateSliderMinHF] minHF = max(minCR) / max(LT) =', maxMinCRPercent, '/', maxLT, '=', minHF);
  
  // Round to 2 decimal places
  const roundedMinHF = Math.round(minHF * 100) / 100;
  console.log('[calculateSliderMinHF] Rounded minHF:', roundedMinHF);
  
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
  
  console.log('[calculateSliderMinHFFromPercentages] minCRs:', minCRs);
  console.log('[calculateSliderMinHFFromPercentages] liquidationRatios:', liquidationRatios);
  console.log('[calculateSliderMinHFFromPercentages] max(minCR) across all vaults:', maxMinCR, '%');
  console.log('[calculateSliderMinHFFromPercentages] max(liquidationRatio) across all vaults:', maxLT, '%');
  
  if (maxLT <= 0) return 1.0;
  
  const minHF = maxMinCR / maxLT;
  console.log('[calculateSliderMinHFFromPercentages] minHF = max(minCR) / max(LT) =', maxMinCR, '/', maxLT, '=', minHF);
  
  const roundedMinHF = Math.round((maxMinCR / maxLT) * 100) / 100;
  console.log('[calculateSliderMinHFFromPercentages] Rounded minHF:', roundedMinHF);
  
  return roundedMinHF;
};

