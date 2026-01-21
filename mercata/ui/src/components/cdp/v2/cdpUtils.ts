import { formatUnits } from 'ethers';
import { formatNumberWithCommas, parseUnitsWithTruncation } from '@/utils/numberUtils';
import type { VaultCandidate, Allocation } from '@/components/cdp/v2/cdpTypes';
import type { DECIMAL, USD, UNITS, WAD, WEI, RAY, ADDRESS } from '@/components/cdp/v2/cdpTypes';
import { getMaxAllocations, getAbsoluteMaxAllocations } from '@/components/cdp/v2/MintService';

// ============================================================================
// Constants
// ============================================================================

// Fixed-point arithmetic constants (values)
export const RAY_UNIT = 10n ** 27n;
export const WAD_UNIT = 10n ** 18n;
export const INF = 2n ** 255n;  // Used as infinity for CR calculations (WAD-scaled)

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
function rpow(x: bigint, n: bigint, ray: bigint = RAY_UNIT): bigint {
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
export function convertStabilityFeeRateToAnnualPercentage(stabilityFeeRateRay: RAY): number {
  if (stabilityFeeRateRay <= RAY_UNIT) return 0;
  
  const MAX_REASONABLE_RATE = RAY_UNIT + (RAY_UNIT / 300000n);
  const cappedRate = stabilityFeeRateRay > MAX_REASONABLE_RATE ? MAX_REASONABLE_RATE : stabilityFeeRateRay;
  
  const annualFactorRay = rpow(cappedRate, SECONDS_PER_YEAR);
  const factorMinusOne = annualFactorRay - RAY_UNIT;
  const integerPart = factorMinusOne / RAY_UNIT;
  const remainder = factorMinusOne % RAY_UNIT;
  const PRECISION_SCALE = BigInt(1e18);
  const fractionalPart = (remainder * PRECISION_SCALE) / RAY_UNIT;
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
 * @param minCR - Minimum CR in WAD format (e.g., 1.5e18 for 150%)
 * @param targetHF - Target health factor (e.g., 1.13)
 * @param liquidationRatio - Liquidation ratio in WAD format (e.g., 1.33e18 for 133%)
 * @returns Target CR in WAD format (e.g., 1.5e18 for 150%)
 */
export function computeTargetCRFromHF(
  minCR: WAD, 
  targetHF: DECIMAL,
  liquidationRatio: WAD
): WAD {
  // Use high precision (1e12) to minimize floating-point rounding errors
  const PRECISION = 1000000000000n; // 1e12
  const targetHFScaled = BigInt(Math.round(targetHF * 1e12));
  
  // targetCR = liquidationRatio * targetHF (in WAD format)
  const targetCRFromHF = (liquidationRatio * targetHFScaled) / PRECISION;
  
  // Ensure we don't go below minCR (would fail on-chain)
  return targetCRFromHF > minCR ? targetCRFromHF : minCR;
}

// ============================================================================
// Collateral Calculations
// ============================================================================

/**
 * Compute collateral value in USDST
 * @param collateralAmount - Collateral amount in native units
 * @param oraclePrice - Oracle price in WEI (18 decimals)
 * @param assetScale - Asset scale (10^decimals, e.g., 1e18 for 18-decimal tokens)
 * @returns Collateral value in USDST (18 decimals)
 */
export function computeCollateralValueUSDST(
  collateralAmount: UNITS,
  oraclePrice: WEI,
  assetScale: UNITS
): WEI {
  if (assetScale === 0n) return 0n;
  return (collateralAmount * oraclePrice) / assetScale;
}

/**
 * Compute required collateral amount for a given debt and target CR
 * @param debtUSD - Debt amount in USD (18 decimals)
 * @param targetCRWad - Target collateralization ratio in WAD format
 * @param oraclePrice - Oracle price in WEI (18 decimals)
 * @param assetScale - Asset scale (10^decimals)
 * @returns Required collateral amount in native units
 */
export function computeRequiredCollateralForCR(
  debtUSD: WEI,
  targetCRWad: WAD,
  oraclePrice: WEI,
  assetScale: UNITS
): UNITS {
  if (oraclePrice === 0n) return 0n;
  const collateralUSDRequired = (debtUSD * targetCRWad) / WAD_UNIT;
  return (collateralUSDRequired * assetScale) / oraclePrice;
}

/**
 * Compute headroom (available mintable amount) for a vault candidate
 * @param vaultCandidate - Vault candidate with collateral and debt information
 * @param targetCR - Target collateralization ratio in WAD format (e.g., 1.5e18 for 150%)
 * @returns Available headroom in WEI (actual mintable USDST amount, not total max debt)
 */
export function computeHeadroom(vaultCandidate: VaultCandidate, targetCR: WAD): WEI {
  const maxCollateral: UNITS = vaultCandidate.currentCollateral + vaultCandidate.potentialCollateral;
  const collateralValue: UNITS = computeCollateralValueUSDST(maxCollateral, vaultCandidate.oraclePrice, vaultCandidate.vaultConfig.unitScale);
  
  const maxDebtRaw = (collateralValue * WAD_UNIT) / targetCR;
  const maxDebt = maxDebtRaw > 1n ? maxDebtRaw - 1n : 0n; // 1-unit buffer is applied cuz on-chain uses strict < check
  return maxDebt > vaultCandidate.currentDebt ? maxDebt - vaultCandidate.currentDebt : 0n;
}

/**
 * Compute total headroom across all vault candidates
 * @param targetHF - Target health factor
 * @param candidates - Array of vault candidates
 * @returns Total available headroom in WEI across all vaults
 */
export function computeTotalHeadroom(
  targetHF: DECIMAL,
  candidates: VaultCandidate[]
): WEI {
  if (candidates.length === 0 || targetHF <= 0) return 0n;

  let totalHeadroom: WEI = 0n;

  for (const candidate of candidates) {
    if ((candidate.potentialCollateral <= 0n && candidate.currentCollateral <= 0n) || candidate.oraclePrice <= 0n) continue;

    const targetCR: WAD = computeTargetCRFromHF(candidate.vaultConfig.minCR, targetHF, candidate.vaultConfig.liquidationRatio);
    const headroom = computeHeadroom(candidate, targetCR);
    totalHeadroom += headroom;
  }

  return totalHeadroom;
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
export const parseDecimalToUnits = (input: string): bigint => {
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

// ============================================================================
// Optimal Allocation Computation Helpers
// ============================================================================

export interface OptimalAllocationResult {
  optimalAllocations: VaultCandidate[];
  debtFloorHit: boolean;
  debtCeilingHit: boolean;
}

/**
 * Compute optimal allocations using MintService
 * Returns empty result if no mint amount or no candidates
 * 
 * @param mintAmount - Mint amount in units
 * @param targetHF - Target health factor
 * @param vaultCandidates - Available vault candidates
 * @param getOptimalAllocations - Function to compute optimal allocations
 * @returns Optimal allocations result with debt floor/ceiling flags
 */
export function computeOptimalAllocations(
  mintAmount: WEI,
  targetHF: DECIMAL,
  vaultCandidates: VaultCandidate[],
  getOptimalAllocations: (mintAmount: WEI, targetHF: DECIMAL, vaultCandidates: VaultCandidate[]) => { allocations: Allocation[]; debtFloorHit: boolean; debtCeilingHit: boolean }
): OptimalAllocationResult {
  // No mint amount or candidates - return empty
  if (mintAmount <= 0n || vaultCandidates.length === 0) {
    return {
      optimalAllocations: [],
      debtFloorHit: false,
      debtCeilingHit: false,
    };
  }
  
  // Compute optimal allocations using MintService
  try {
    const result = getOptimalAllocations(mintAmount, targetHF, vaultCandidates);
    const candidatesWithAllocations = addAllocationsToVaultCandidates(result.allocations, vaultCandidates);
    return {
      optimalAllocations: candidatesWithAllocations,
      debtFloorHit: result.debtFloorHit,
      debtCeilingHit: result.debtCeilingHit,
    };
  } catch {
    return {
      optimalAllocations: [],
      debtFloorHit: false,
      debtCeilingHit: false,
    };
  }
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
export const calculateTotalMaxMint = (vaultCandidates: VaultCandidate[]): WEI => {
  // mintAmount is in WEI (USDST, always 18 decimals)
  return vaultCandidates.reduce((sum, v) => {
    return sum + (v.allocation?.mintAmount || 0n);
  }, 0n);
};

export const calculateAvailableToMint = (totalMaxMint: WEI): string => {
  if (totalMaxMint > 0n) {
    const amount = parseFloat(formatUnits(totalMaxMint, 18));
    const rounded = Math.round(amount * 100) / 100; // Round to 2 decimals
    return formatNumberWithCommas(rounded.toFixed(2));
  }
  return '0.00';
};

// APR calculation utilities
export const calculateWeightedAverageAPR = (vaultCandidates: VaultCandidate[]): DECIMAL => {
  if (vaultCandidates.length === 0) return 0;
  let totalMint: DECIMAL = 0;
  let weightedSum: DECIMAL = 0;
  
  for (const v of vaultCandidates) {
    if (!v.allocation) continue;
    const mint = parseFloat(formatUnits(v.allocation.mintAmount, 18));
    // stabilityFeeRate is in RAY format (27 decimals), convert to annual percentage
    const feeRate = convertStabilityFeeRateToAnnualPercentage(v.vaultConfig.stabilityFeeRate);
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
  totalDebt: USD;
  weightedAverageFee: DECIMAL;
  totalCollateralUSD: USD;
  overallHealthFactor: DECIMAL;
}

export const calculatePositionMetrics = (
  positions: Array<{
    debtAmount: string;
    collateralValueUSD: string;
    stabilityFeeRate: DECIMAL;  // Note: this is decimal percentage, not units
    liquidationRatio: DECIMAL;
    collateralizationRatio: DECIMAL;
  }>,
  formatWeiToDecimalHP: (value: string, decimals: number) => string
): PositionCalculationResult => {
  const totalMinted: USD = positions.reduce((sum, pos) => {
    const debt: USD = parseFloat(formatWeiToDecimalHP(pos.debtAmount, 18));
    return sum + debt;
  }, 0);

  let totalDebt: USD = 0;
  let weightedSum: DECIMAL = 0;
  
  positions.forEach(pos => {
    const debt: USD = parseFloat(formatWeiToDecimalHP(pos.debtAmount, 18));
    if (debt > 0) {
      totalDebt += debt;
      weightedSum += debt * pos.stabilityFeeRate;
    }
  });
  
  const weightedAverageFee: DECIMAL = totalDebt > 0 ? weightedSum / totalDebt : 0;

  const totalCollateralUSD: USD = positions.reduce((sum, pos) => {
    const collateralUSD: USD = parseFloat(formatWeiToDecimalHP(pos.collateralValueUSD, 18));
    return sum + collateralUSD;
  }, 0);

  if (totalDebt === 0) {
    return {
      totalDebt,
      weightedAverageFee,
      totalCollateralUSD,
      overallHealthFactor: Infinity,
    };
  }
  
  // Calculate weighted average liquidation ratio
  let totalDebtForLT: USD = 0;
  let weightedLT: DECIMAL = 0;
  
  positions.forEach(pos => {
    const debt: USD = parseFloat(formatWeiToDecimalHP(pos.debtAmount, 18));
    if (debt > 0) {
      totalDebtForLT += debt;
      weightedLT += debt * pos.liquidationRatio;
    }
  });
  
  if (totalDebtForLT === 0) {
    return {
      totalDebt,
      weightedAverageFee,
      totalCollateralUSD,
      overallHealthFactor: Infinity,
    };
  }
  
  const avgLT = weightedLT / totalDebtForLT;
  const cr = (totalCollateralUSD / totalDebt) * 100;
  
  const overallHealthFactor = cr / avgLT;

  return {
    totalDebt,
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
    currentCollateral: UNITS;
    currentDebt: WEI;
    depositAmount: number; // New deposit to add (in token units)
    mintAmount: number; // New mint to add (in USDST)
    oraclePrice: WEI;
    unitScale: UNITS;
    liquidationRatio: WAD;
    decimals: number; // Token decimals for parsing deposit
  }>
): string | null => {
  // Use BigInt accumulators for precision
  let totalCollateralUSD: WEI = 0n;
  let totalDebtUSD: WEI = 0n;
  let weightedLTSum: bigint = 0n; // Sum of (debt * LT) in WAD format
  
  for (const vault of vaults) {
    // Calculate total debt for this vault (existing + new mint)
    // Use parseUnitsWithTruncation to handle amounts with too many decimal places
    const mintUnits: WEI = vault.mintAmount > 0 ? parseUnitsWithTruncation(vault.mintAmount.toString(), 18) : 0n;
    const totalDebt: WEI = vault.currentDebt + mintUnits;
    
    // Skip vaults with zero debt (they have infinite HF)
    if (totalDebt <= 0n) continue;

    // Calculate total collateral (existing + new deposit)
    // Use parseUnitsWithTruncation to handle amounts with too many decimal places
    const depositUnits: UNITS = vault.depositAmount > 0 ? parseUnitsWithTruncation(vault.depositAmount.toString(), vault.decimals) : 0n;
    const totalCollateral: UNITS = vault.currentCollateral + depositUnits;
    
    // Calculate collateral value in USD (keep as BigInt)
    const collateralValueUSD: WEI = (totalCollateral * vault.oraclePrice) / vault.unitScale;
    
    // Liquidation ratio is in WAD format (e.g., 1.5e18 for 150%)
    // Multiply by 100 to get percentage in WAD format (e.g., 150e18 for 150%)
    const ltWAD: bigint = vault.liquidationRatio * 100n;
    
    // Accumulate totals for aggregate calculation (all in BigInt)
    totalCollateralUSD += collateralValueUSD;
    totalDebtUSD += totalDebt;
    
    // weightedLTSum = sum of (debt * LT) where LT is in percentage WAD format
    // debt is in WEI (18 decimals), LT is in WAD (18 decimals)
    // To keep precision, we calculate: (totalDebt * ltWAD) / WAD_UNIT
    weightedLTSum += (totalDebt * ltWAD) / WAD_UNIT;
  }

  // Need at least some debt to calculate HF
  if (totalDebtUSD <= 0n) return null;

  // Calculate weighted average liquidation threshold
  // weightedLTSum is sum of (debt * LT), so divide by totalDebtUSD to get weighted avg
  // Result is in percentage (e.g., 150 for 150%)
  // We need to scale up to WAD precision: (weightedLTSum * WAD) / totalDebtUSD
  const weightedAvgLTWAD: bigint = (weightedLTSum * WAD_UNIT) / totalDebtUSD;
  
  // Calculate aggregate collateralization ratio as percentage in WAD format
  // CR = (totalCollateralUSD / totalDebtUSD) * 100
  // To maintain precision: (totalCollateralUSD * 100 * WAD) / totalDebtUSD
  const aggregateCRWAD: bigint = (totalCollateralUSD * 100n * WAD_UNIT) / totalDebtUSD;
  
  // Calculate overall health factor: CR / weightedAvgLT (both in WAD format)
  // HF = (aggregateCRWAD * WAD) / weightedAvgLTWAD
  const overallHFWAD: bigint = (aggregateCRWAD * WAD_UNIT) / weightedAvgLTWAD;
  
  // Convert to decimal only at the very end
  const overallHF = parseFloat(formatUnits(overallHFWAD, 18));
  
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
// Vault Calculation Utilities
// ============================================================================

/**
 * Calculate minimum health factor for a specific vault (for display, rounded)
 * minHF = minCR / liquidationRatio
 */
export const calculateVaultMinHF = (candidate: VaultCandidate): number => {
  const minCRPercent = parseFloat(formatUnits(candidate.vaultConfig.minCR, 18)) * 100;
  const ltPercent = parseFloat(formatUnits(candidate.vaultConfig.liquidationRatio, 18)) * 100;
  if (ltPercent <= 0) return 1.0;
  return Math.round((minCRPercent / ltPercent) * 100) / 100;
};

/**
 * Calculate minimum health factor for validation (unrounded for precise comparisons)
 */
export const calculateVaultMinHFRaw = (candidate: VaultCandidate): number => {
  const minCRPercent = parseFloat(formatUnits(candidate.vaultConfig.minCR, 18)) * 100;
  const ltPercent = parseFloat(formatUnits(candidate.vaultConfig.liquidationRatio, 18)) * 100;
  if (ltPercent <= 0) return 1.0;
  return minCRPercent / ltPercent;
};

/**
 * Calculate raw health factor for a vault with given deposit and mint amounts
 * Returns null for infinite/invalid values
 */
export const calculateVaultHFRaw = (
  candidate: VaultCandidate,
  depositAmt: DECIMAL,
  mintAmt: DECIMAL
): DECIMAL | null => {
  try {
    const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
    const depositUnits: UNITS = depositAmt > 0 ? parseUnitsWithTruncation(depositAmt.toString(), decimals) : 0n;
    const mintUnits: WEI = mintAmt > 0 ? parseUnitsWithTruncation(mintAmt.toString(), 18) : 0n;

    const totalCollateral: UNITS = candidate.currentCollateral + depositUnits;
    const totalDebt: WEI = candidate.currentDebt + mintUnits;

    if (totalDebt <= 0n) return null;

    // Keep all calculations in BigInt for maximum precision
    const collateralValueUSD: WEI = (totalCollateral * candidate.oraclePrice) / candidate.vaultConfig.unitScale;
    
    // Calculate CR as WAD: (collateralValueUSD * WAD * 100) / totalDebt
    // This gives us CR as a percentage in WAD format (e.g., 155% = 155e18)
    const crWAD: bigint = (collateralValueUSD * WAD_UNIT * 100n) / totalDebt;
    
    // LT is already in WAD format (e.g., 1.5e18 for 150%), multiply by 100 to get percentage
    const ltWAD: bigint = candidate.vaultConfig.liquidationRatio * 100n;
    
    // Calculate HF: (crWAD * WAD) / ltWAD
    // This gives us HF in WAD format (e.g., 1.03e18 for HF of 1.03)
    const hfWAD: bigint = (crWAD * WAD_UNIT) / ltWAD;
    
    // Convert to decimal only at the very end
    const hf = parseFloat(formatUnits(hfWAD, 18));

    if (!isFinite(hf) || isNaN(hf) || hf >= 999) return null;
    return hf;
  } catch {
    return null;
  }
};

/**
 * Calculate health factor for display (formatted string)
 */
export const calculateVaultHF = (
  candidate: VaultCandidate,
  depositAmt: DECIMAL,
  mintAmt: DECIMAL
): string => {
  const mintUnits: WEI = mintAmt > 0 ? parseUnitsWithTruncation(mintAmt.toString(), 18) : 0n;
  const totalDebt: WEI = candidate.currentDebt + mintUnits;
  if (totalDebt <= 0n) return '∞';

  const hfRaw = calculateVaultHFRaw(candidate, depositAmt, mintAmt);
  return hfRaw !== null ? hfRaw.toFixed(2) : '∞';
};

/**
 * Calculate maximum mintable amount for a vault (returns DECIMAL)
 * Wrapper around calculateMaxMintUnitsForVault that converts to decimal
 */
export const calculateMaxMintForVault = (candidate: VaultCandidate, depositAmt: DECIMAL): DECIMAL => {
  const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
  const depositUnits: UNITS = depositAmt > 0 ? parseUnitsWithTruncation(depositAmt.toString(), decimals) : 0n;
  const maxMintUnits: WEI = calculateMaxMintUnitsForVault(candidate, depositUnits);
  return parseFloat(formatUnits(maxMintUnits, 18));
};

/**
 * Calculate max mintable units for a vault (used for exact comparisons)
 * Uses minCR (on-chain constraint) not targetCR (user's risk buffer)
 * Applies 1-unit buffer for on-chain strict < check
 */
export const calculateMaxMintUnitsForVault = (
  candidate: VaultCandidate,
  depositUnits: UNITS
): WEI => {
  const totalCollateral: UNITS = candidate.currentCollateral + depositUnits;
  const collateralValueUSD: UNITS = (totalCollateral * candidate.oraclePrice) / candidate.vaultConfig.unitScale;
  const maxBorrowableUSD: UNITS = (collateralValueUSD * WAD_UNIT) / candidate.vaultConfig.minCR;
  
  if (maxBorrowableUSD <= candidate.currentDebt) return 0n;
  const available: UNITS = maxBorrowableUSD - candidate.currentDebt;
  return available > 1n ? (available - 1n) : 0n;
};

/**
 * Truncate number for display (6 significant figures)
 */
export const truncateForDisplay = (value: number): string => {
  if (isNaN(value) || value === 0) return '0';
  if (Math.abs(value) < 0.000001) return value.toExponential(2);
  const precision = Math.max(0, 6 - Math.floor(Math.log10(Math.abs(value))) - 1);
  const truncated = value.toFixed(Math.min(precision, 6));
  
  // Add comma formatting
  const num = parseFloat(truncated);
  return num.toLocaleString('en-US', { 
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(precision, 6)
  });
};

/**
 * Get HF color class based on value
 */
export const getHFColorClass = (hf: string, hfNum: number): string => {
  if (isNaN(hfNum) || hf === '∞') return 'text-green-600';
  if (hfNum >= 2.0) return 'text-green-600';
  if (hfNum >= 1.5) return 'text-yellow-600';
  return 'text-red-600';
};

// ============================================================================
// Health Factor Slider Utilities
// ============================================================================

/**
 * Get slider color based on target health factor
 * @param targetHF - Target health factor value
 * @returns CSS color string
 */
export const getSliderColor = (targetHF: number): string => {
  if (targetHF >= 2.5) return '#10b981'; // green
  if (targetHF >= 2.0) return '#3b82f6'; // blue
  if (targetHF >= 1.5) return '#eab308'; // yellow
  return '#ef4444'; // red
};

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
  const maxMinCRPercent = Number(maxMinCRWad) / Number(WAD_UNIT) * 100; // Convert to percentage
  
  // Find max liquidation ratio from all vault candidates (liquidationRatio is in WAD format)
  const maxLRWad = vaultCandidates.reduce((max, v) => v.vaultConfig.liquidationRatio > max ? v.vaultConfig.liquidationRatio : max, 0n);
  const maxLT = Number(maxLRWad) / Number(WAD_UNIT) * 100; // Convert to percentage
  
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

/**
 * Find the maximum achievable health factor that allows minting
 * Starts at a high HF and decreases until available to mint > 0
 * @param vaultCandidates - Array of vault candidates
 * @param minHF - Minimum allowed health factor (from slider)
 * @param startHF - Starting health factor to try
 * @param step - Step size to decrease HF by
 * @returns The optimal health factor, or minHF if none found
 */
export const findMaxAchievableHF = (
  vaultCandidates: VaultCandidate[],
  minHF: number,
  startHF: number,
  step: number
): number => {
  if (vaultCandidates.length === 0) return startHF;
  
  let currentHF = startHF;
  
  // Try HF values from startHF down to minHF
  while (currentHF >= minHF) {
    try {
      const isAtMinHF = Math.abs(currentHF - minHF) < 0.01;
      const allocations = isAtMinHF
        ? getAbsoluteMaxAllocations(vaultCandidates)
        : getMaxAllocations(vaultCandidates, currentHF);
      
      const vaultsWithAllocations = addAllocationsToVaultCandidates(allocations, vaultCandidates);
      const totalMaxMint = calculateTotalMaxMint(vaultsWithAllocations);
      
      // If we can mint something at this HF, return it
      if (totalMaxMint > 0n) {
        return Math.round(currentHF * 100) / 100; // Round to 2 decimal places
      }
    } catch (error) {
      console.warn(`[findMaxAchievableHF] Error at HF ${currentHF}:`, error);
    }
    
    currentHF -= step;
  }
  
  // If no HF worked, return minHF as fallback
  return minHF;
};

