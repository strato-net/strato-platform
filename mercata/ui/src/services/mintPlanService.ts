import {
  RAY,
  WAD,
  INF,
  computeTargetCRWadFromRiskBuffer,
  computeCollateralUSD,
  computeRequiredCollateralForCR,
} from "./cdpUtils";

// API response format (all values as strings)
export interface VaultCandidateAPI {
  assetAddress: string;
  symbol: string;
  assetScale: string;
  minCR: string;
  stabilityFeeRate: string;
  oraclePrice: string;
  currentCollateral: string;
  potentialCollateral: string;
  currentDebt: string;
  globalDebt: string;
  debtFloor: string;
  debtCeiling: string;
}

// Convert API response to internal format (strings to bigint)
export function apiToVaultCandidate(api: VaultCandidateAPI): VaultCandidate {
  return {
    assetAddress: api.assetAddress,
    symbol: api.symbol,
    assetScale: BigInt(api.assetScale),
    minCR: BigInt(api.minCR),
    stabilityFeeRate: BigInt(api.stabilityFeeRate),
    oraclePrice: BigInt(api.oraclePrice),
    currentCollateral: BigInt(api.currentCollateral),
    potentialCollateral: BigInt(api.potentialCollateral),
    currentDebt: BigInt(api.currentDebt),
    globalDebt: BigInt(api.globalDebt),
    debtFloor: BigInt(api.debtFloor),
    debtCeiling: BigInt(api.debtCeiling),
  };
}

// Local interfaces for allocation function (simpler versions)
// All bigint values are in their smallest unit (wei for 18-decimal tokens, satoshi for 8-decimal, etc.)
// "Collateral" = native asset units, "Debt/Mint" = USDST (always 18 decimals)
export interface VaultCandidate {
  assetAddress: string;
  symbol: string;                 // Asset symbol (e.g., "ETH", "WBTC")
  assetScale: bigint;             // 10^decimals (e.g., 1e18 for 18-decimal assets)
  minCR: bigint;                  // WAD format (1.5e18 = 150% CR)
  stabilityFeeRate: bigint;       // Per-second rate
  oraclePrice: bigint;            // Price per unit in USDST (18 decimals)
  currentCollateral: bigint;      // User's current collateral (native asset units)
  potentialCollateral: bigint;    // User's available balance (native asset units)
  currentDebt: bigint;            // User's current debt (USDST, 18 decimals)
  globalDebt: bigint;             // Global debt for this asset (USDST, 18 decimals)
  debtFloor: bigint;              // Minimum debt per vault (USDST, 18 decimals)
  debtCeiling: bigint;            // Maximum global debt (USDST, 18 decimals)
}

interface Allocation {
  assetAddress: string;
  depositAmount: bigint;          // Collateral to deposit (native asset units)
  mintAmount: bigint;             // USDST to mint (18 decimals)
}

/**
 * Get max possible allocations for each candidate vault.
 * Unlike getOptimalAllocations which distributes a target amount,
 * this returns the maximum mintable from EACH vault independently.
 */
export function getMaxAllocations(
  candidates: VaultCandidate[],
  riskBuffer: number
): Allocation[] {
  if (candidates.length === 0 || riskBuffer <= 0) return [];

  const allocations: Allocation[] = [];

  for (const candidate of candidates) {
    // Skip candidates with no collateral or invalid oracle price
    if ((candidate.potentialCollateral <= 0n && candidate.currentCollateral <= 0n) || candidate.oraclePrice <= 0n) {
      continue;
    }

    const targetCR = computeTargetCRWadFromRiskBuffer(candidate.minCR, riskBuffer);
    
    // Compute max headroom for this candidate (collateral + ceiling constrained)
    const headroom = computeHeadroom(candidate, targetCR);
    
    if (headroom <= 0n) continue;

    // Use allocate() with headroom as the max we want to mint
    // Pass candidate's current globalDebt (not tracking across allocations since each is independent)
    const result = allocate(candidate, headroom, targetCR, candidate.globalDebt);

    if (result !== 'DEBT_FLOOR_HIT' && result !== 'DEBT_CEILING_HIT' && result.mintAmount > 0n) {
      allocations.push(result);
    }
  }

  return allocations;
}

// Helper to compute headroom for a single candidate (used by both sorting and total headroom calculation)
function computeHeadroom(c: VaultCandidate, targetCR: bigint): bigint {
  const maxCollateral = c.currentCollateral + c.potentialCollateral;
  const collateralValue = computeCollateralUSD(maxCollateral, c.oraclePrice, c.assetScale);
  const maxDebtRaw = (collateralValue * WAD) / targetCR;
  const maxDebtFromCollateral = maxDebtRaw > 0n ? maxDebtRaw - 1n : 0n;
  const headroomFromCollateral = maxDebtFromCollateral > c.currentDebt 
    ? maxDebtFromCollateral - c.currentDebt 
    : 0n;

  const headroomFromCeiling = c.debtCeiling === 0n
    ? INF
    : c.globalDebt >= c.debtCeiling ? 0n : c.debtCeiling - c.globalDebt;

  return headroomFromCollateral < headroomFromCeiling ? headroomFromCollateral : headroomFromCeiling;
}

export function computeTotalHeadroom(
  riskBuffer: number,
  candidates: VaultCandidate[]
): bigint {
  if (candidates.length === 0 || riskBuffer <= 0) return 0n;

  let totalHeadroom = 0n;

  for (const candidate of candidates) {
    if ((candidate.potentialCollateral <= 0n && candidate.currentCollateral <= 0n) || candidate.oraclePrice <= 0n) continue;

    const targetCR = computeTargetCRWadFromRiskBuffer(candidate.minCR, riskBuffer);
    const headroom = computeHeadroom(candidate, targetCR);
    totalHeadroom += headroom;
  }

  return totalHeadroom;
}

  // Helper to sort candidates by stability fee rate, then by existing collateral, then by headroom
  const sortCandidates = (candidates: VaultCandidate[], riskBuffer: number): VaultCandidate[] => {
    const sortedCandidates = [...candidates].sort((a, b) => {
      // Primary: sort by stability fee rate (ascending - lower fee first)
      if (a.stabilityFeeRate < b.stabilityFeeRate) return -1;
      if (a.stabilityFeeRate > b.stabilityFeeRate) return 1;
  
      // First tie-breaker: prioritize vaults with existing collateral
      const hasCollateralA = a.currentCollateral > 0n;
      const hasCollateralB = b.currentCollateral > 0n;
      if (hasCollateralA && !hasCollateralB) return -1;
      if (!hasCollateralA && hasCollateralB) return 1;
  
      // Second tie-breaker: sort by headroom (descending - more headroom first)
      const targetCRA = computeTargetCRWadFromRiskBuffer(a.minCR, riskBuffer);
      const targetCRB = computeTargetCRWadFromRiskBuffer(b.minCR, riskBuffer);
      const headroomA = computeHeadroom(a, targetCRA);
      const headroomB = computeHeadroom(b, targetCRB);
  
      if (headroomA > headroomB) return -1;
      if (headroomA < headroomB) return 1;
      return 0;
    });
    return sortedCandidates;
  };

interface Allocations {
  allocations: Allocation[];
  debtFloorHit: boolean;
  debtCeilingHit: boolean;
}

export function getOptimalAllocations(
  targetMint: bigint,
  riskBuffer: number,
  candidates: VaultCandidate[]
): Allocations {
  if (targetMint <= 0n || candidates.length === 0 || riskBuffer <= 0) {
    return { allocations: [], debtFloorHit: false, debtCeilingHit: false };
  }

  const allocations: Allocation[] = [];
  let remainingMint = targetMint;
  let debtFloorHit = false;
  let debtCeilingHit = false;

  // Sort candidates by stability fee rate, then by existing collateral, then by headroom
  const sortedCandidates = sortCandidates(candidates, riskBuffer);

  // Track global debt as we allocate (updates as we mint)
  const globalDebtByAsset = new Map<string, bigint>();
  for (const c of sortedCandidates) {
    globalDebtByAsset.set(c.assetAddress, c.globalDebt);
  }

  // Iterate through sorted candidates and allocate
  for (const candidate of sortedCandidates) {
    if (remainingMint <= 0n) break;

    // Skip candidates with no collateral or invalid oracle price
    if ((candidate.potentialCollateral <= 0n && candidate.currentCollateral <= 0n) || candidate.oraclePrice <= 0n) {
      continue;
    }

    const targetCR = computeTargetCRWadFromRiskBuffer(candidate.minCR, riskBuffer);
    const currentGlobalDebt = globalDebtByAsset.get(candidate.assetAddress) ?? candidate.globalDebt;
    const result = allocate(candidate, remainingMint, targetCR, currentGlobalDebt);
    
    if (result === 'DEBT_FLOOR_HIT') {
      debtFloorHit = true;
      continue;
    }
    
    if (result === 'DEBT_CEILING_HIT') {
      debtCeilingHit = true;
      continue;
    }
    
    if (result && result.mintAmount > 0n) {
      allocations.push(result);
      remainingMint -= result.mintAmount;
      // Update tracked global debt for this asset
      globalDebtByAsset.set(candidate.assetAddress, currentGlobalDebt + result.mintAmount);
    }
  }

  return { allocations, debtFloorHit, debtCeilingHit };
}

function allocate(
  candidate: VaultCandidate,
  remainingMint: bigint,
  targetCR: bigint,
  globalDebt: bigint
): Allocation | 'DEBT_FLOOR_HIT' | 'DEBT_CEILING_HIT' {
  let mintAmount = remainingMint;
  let depositAmount = 0n;

  const currentCollateralValue = computeCollateralUSD(
    candidate.currentCollateral,
    candidate.oraclePrice,
    candidate.assetScale
  );
  const maxCollateral = candidate.currentCollateral + candidate.potentialCollateral;
  const maxCollateralValue = computeCollateralUSD(maxCollateral, candidate.oraclePrice, candidate.assetScale);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Compute CR and determine deposit needed
  // ═══════════════════════════════════════════════════════════════════════════
  const newDebt = candidate.currentDebt + mintAmount;
  const currentCR = newDebt > 0n ? (currentCollateralValue * WAD) / newDebt : INF;

  if (currentCR >= targetCR) {
    // Happy path: no deposit needed
    depositAmount = 0n;
  } else {
    // Need deposit - check if full deposit is enough
    const maxCR = newDebt > 0n ? (maxCollateralValue * WAD) / newDebt : INF;

    if (maxCR < targetCR) {
      // Even full deposit isn't enough → reduce mint to achievable amount
      const maxDebtFromCollateral = (maxCollateralValue * WAD) / targetCR;
      mintAmount = maxDebtFromCollateral > candidate.currentDebt
        ? maxDebtFromCollateral - candidate.currentDebt
        : 0n;
      depositAmount = candidate.potentialCollateral;
    } else {
      // Find minimum deposit needed to achieve target CR
      const requiredCollateral = computeRequiredCollateralForCR(
        newDebt,
        targetCR,
        candidate.oraclePrice,
        candidate.assetScale
      );
      depositAmount = requiredCollateral > candidate.currentCollateral
        ? requiredCollateral - candidate.currentCollateral
        : 0n;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Check debt ceiling
  // ═══════════════════════════════════════════════════════════════════════════
  if (candidate.debtCeiling > 0n) {
    const ceilingHeadroom = candidate.debtCeiling > globalDebt
      ? candidate.debtCeiling - globalDebt
      : 0n;

    if (ceilingHeadroom <= 0n) {
      return 'DEBT_CEILING_HIT'; // No room under ceiling, skip
    }

    if (mintAmount > ceilingHeadroom) {
      // Cap mint to ceiling and recalculate deposit
      mintAmount = ceilingHeadroom;
      const newDebtAfterCap = candidate.currentDebt + mintAmount;
      const currentCRAfterCap = newDebtAfterCap > 0n
        ? (currentCollateralValue * WAD) / newDebtAfterCap
        : INF;

      if (currentCRAfterCap >= targetCR) {
        depositAmount = 0n;
      } else {
        const maxCRAfterCap = newDebtAfterCap > 0n
          ? (maxCollateralValue * WAD) / newDebtAfterCap
          : INF;

        if (maxCRAfterCap < targetCR) {
          return 'DEBT_CEILING_HIT'; // Can't achieve target CR with ceiling constraint
        }

        const requiredCollateral = computeRequiredCollateralForCR(
          newDebtAfterCap,
          targetCR,
          candidate.oraclePrice,
          candidate.assetScale
        );
        depositAmount = requiredCollateral > candidate.currentCollateral
          ? requiredCollateral - candidate.currentCollateral
          : 0n;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Check debt floor (simplified)
  // ═══════════════════════════════════════════════════════════════════════════
  const newTotalDebt = candidate.currentDebt + mintAmount;

  if (newTotalDebt > 0n && newTotalDebt < candidate.debtFloor) {
    return 'DEBT_FLOOR_HIT';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Final validation
  // ═══════════════════════════════════════════════════════════════════════════
  if (mintAmount <= 0n) {
    return 'DEBT_FLOOR_HIT';
  }

  return {
    assetAddress: candidate.assetAddress,
    mintAmount,
    depositAmount,
  };
}
