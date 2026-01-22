import {
  WAD_UNIT,
  INF,
  computeTargetCRFromHF,
  computeRequiredCollateralForCR,
  computeCollateralValueUSDST,
  computeHeadroom,
} from "@/components/cdp/v2/cdpUtils";
import type { Allocation, VaultCandidate, UNITS, WAD, WEI, USD, DECIMAL, ADDRESS } from "@/components/cdp/v2/cdpTypes";

// API response format (all values as strings)
export interface VaultCandidateAPI {
  assetAddress: ADDRESS;
  symbol: string;
  assetScale: string;
  minCR: string;
  liquidationRatio: string;
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
    vaultConfig: {
      assetAddress: api.assetAddress,
      symbol: api.symbol,
      unitScale: BigInt(api.assetScale),
      minCR: BigInt(api.minCR),
      liquidationRatio: BigInt(api.liquidationRatio),
      stabilityFeeRate: BigInt(api.stabilityFeeRate),
      debtFloor: BigInt(api.debtFloor),
      debtCeiling: BigInt(api.debtCeiling),
    },
    oraclePrice: BigInt(api.oraclePrice),
    currentCollateral: BigInt(api.currentCollateral),
    potentialCollateral: BigInt(api.potentialCollateral),
    currentDebt: BigInt(api.currentDebt),
    globalDebt: BigInt(api.globalDebt),
  };
}

/**
 * Get max possible allocations for each candidate vault.
 * Unlike getOptimalAllocations which distributes a target amount,
 * this returns the maximum mintable from EACH vault independently.
 * Always deposits ALL available collateral to maximize mint.
 */
export function getMaxAllocations(
  candidates: VaultCandidate[],
  targetHF: DECIMAL
): Allocation[] {
  if (candidates.length === 0 || targetHF <= 0) return [];
  
  const allocations: Allocation[] = [];

  // Track asset balances > 0 for comparison
  const assetBalances: Array<{ assetAddress: ADDRESS; symbol: string; balance: UNITS }> = [];

  for (const candidate of candidates) {
    if ((candidate.potentialCollateral <= 0n && candidate.currentCollateral <= 0n) || candidate.oraclePrice <= 0n) {
      continue;
    }

    const targetCR: WAD = computeTargetCRFromHF(candidate.vaultConfig.minCR, targetHF, candidate.vaultConfig.liquidationRatio);
    const headroom: WEI = computeHeadroom(candidate, targetCR);
    if (headroom <= 0n) continue;

    const result = allocate(candidate, headroom, targetCR, candidate.globalDebt, true);

    // Only push if result is an Allocation (not an error string) with mintAmount > 0
    if (result !== 'DEBT_FLOOR_HIT' && result !== 'DEBT_CEILING_HIT' && result !== 'NO_HEADROOM' && result.mintAmount > 0n) {
      allocations.push(result);
    }
  }

  return allocations;
}

// Only used when HF slider is at rightmost (minimum HF) AND max mode is enabled
export function getAbsoluteMaxAllocations(candidates: VaultCandidate[]): Allocation[] {
  if (candidates.length === 0) return [];
  
  const allocations: Allocation[] = [];
  for (const candidate of candidates) {
    if (candidate.oraclePrice <= 0n) {
      continue;
    }

    const totalCollateral: UNITS = candidate.currentCollateral + candidate.potentialCollateral;
    
    if (totalCollateral <= 0n) {
      continue;
    }
    
    const collateralValueUSD: UNITS = (totalCollateral * candidate.oraclePrice) / candidate.vaultConfig.unitScale;
    const maxBorrowableUSD: UNITS = (collateralValueUSD * WAD_UNIT) / candidate.vaultConfig.minCR;
    
    let maxMintAmount: WEI;
    if (maxBorrowableUSD <= candidate.currentDebt) {
      maxMintAmount = 0n;
    } else {
      const available: UNITS = maxBorrowableUSD - candidate.currentDebt;
      maxMintAmount = available > 1n ? (available - 1n) : 0n;
    }
    
    // Check debt ceiling
    if (candidate.vaultConfig.debtCeiling > 0n && candidate.globalDebt < candidate.vaultConfig.debtCeiling) {
      const ceilingHeadroom = candidate.vaultConfig.debtCeiling - candidate.globalDebt;
      if (maxMintAmount > ceilingHeadroom) {
        maxMintAmount = ceilingHeadroom;
      }
    }
    
    // Check debt floor
    const totalDebt = candidate.currentDebt + maxMintAmount;
    if (totalDebt > 0n && totalDebt < candidate.vaultConfig.debtFloor) {
      continue;
    }
    
    if (maxMintAmount > 0n) {
      allocations.push({
        assetAddress: candidate.vaultConfig.assetAddress,
        depositAmount: candidate.potentialCollateral,
        mintAmount: maxMintAmount,
      });
    }
  }

  return allocations;
}


// Sort candidates: existing vaults first (by available headroom), then potential vaults (by available headroom)
const sortCandidates = (candidates: VaultCandidate[], targetHF: DECIMAL): VaultCandidate[] => {
  // Separate existing vaults (have currentCollateral or currentDebt) from potential vaults
  const existingVaults: VaultCandidate[] = [];
  const potentialVaults: VaultCandidate[] = [];
  
  for (const c of candidates) {
    if (c.currentCollateral > 0n || c.currentDebt > 0n) {
      existingVaults.push(c);
    } else if (c.potentialCollateral > 0n) {
      potentialVaults.push(c);
    }
  }
  
  // Sort existing vaults by available headroom (descending)
  existingVaults.sort((a, b) => {
    const targetCRA: WAD = computeTargetCRFromHF(a.vaultConfig.minCR, targetHF, a.vaultConfig.liquidationRatio);
    const targetCRB: WAD = computeTargetCRFromHF(b.vaultConfig.minCR, targetHF, b.vaultConfig.liquidationRatio);
    const headroomA = computeHeadroom(a, targetCRA);
    const headroomB = computeHeadroom(b, targetCRB);
    if (headroomA > headroomB) return -1;
    if (headroomA < headroomB) return 1;
    return 0;
  });
  
  // Sort potential vaults by available headroom (descending)
  potentialVaults.sort((a, b) => {
    const targetCRA: WAD = computeTargetCRFromHF(a.vaultConfig.minCR, targetHF, a.vaultConfig.liquidationRatio);
    const targetCRB: WAD = computeTargetCRFromHF(b.vaultConfig.minCR, targetHF, b.vaultConfig.liquidationRatio);
    const headroomA = computeHeadroom(a, targetCRA);
    const headroomB = computeHeadroom(b, targetCRB);
    if (headroomA > headroomB) return -1;
    if (headroomA < headroomB) return 1;
    return 0;
  });
  
  // Concat: existing vaults first, then potential vaults
  return [...existingVaults, ...potentialVaults];
};

interface Allocations {
  allocations: Allocation[];
  debtFloorHit: boolean;
  debtCeilingHit: boolean;
}

export function getOptimalAllocations(
  targetMint: UNITS,
  targetHF: DECIMAL,
  candidates: VaultCandidate[]
): Allocations {
  if (targetMint <= 0n || candidates.length === 0 || targetHF <= 0) {
    return { allocations: [], debtFloorHit: false, debtCeilingHit: false };
  }

  const allocations: Allocation[] = [];
  let remainingMint: UNITS = targetMint;
  let debtFloorHit = false;
  let debtCeilingHit = false;

  // Sort candidates by stability fee rate, then by existing collateral, then by headroom
  const sortedCandidates = sortCandidates(candidates, targetHF);

  // Track global debt as we allocate (updates as we mint)
  const globalDebtByAsset = new Map<ADDRESS, UNITS>();
  for (const c of sortedCandidates) {
    globalDebtByAsset.set(c.vaultConfig.assetAddress, c.globalDebt);
  }

  // Iterate through sorted candidates and allocate
  for (const candidate of sortedCandidates) {
    if (remainingMint <= 0n) break;

    // Skip candidates with no collateral or invalid oracle price
    if ((candidate.potentialCollateral <= 0n && candidate.currentCollateral <= 0n) || candidate.oraclePrice <= 0n) {
      continue;
    }

    const targetCR: WAD = computeTargetCRFromHF(candidate.vaultConfig.minCR, targetHF, candidate.vaultConfig.liquidationRatio);
    const currentGlobalDebt = globalDebtByAsset.get(candidate.vaultConfig.assetAddress) ?? candidate.globalDebt;
    const result = allocate(candidate, remainingMint, targetCR, currentGlobalDebt, false);
    
    if (result === 'DEBT_FLOOR_HIT') {
      debtFloorHit = true;
      continue;
    }
    
    if (result === 'DEBT_CEILING_HIT') {
      debtCeilingHit = true;
      continue;
    }
    
    if (result === 'NO_HEADROOM') {
      // No mintable headroom at target CR - vault is at or above capacity for the current risk buffer
      continue;
    }
    
    if (result && result.mintAmount > 0n) {
      allocations.push(result);
      remainingMint -= result.mintAmount;
      // Update tracked global debt for this asset
      globalDebtByAsset.set(candidate.vaultConfig.assetAddress, currentGlobalDebt + result.mintAmount);
    }
  }

  return { allocations, debtFloorHit, debtCeilingHit };
}

/**
 * Helper: Deposit all available collateral and calculate maximum safe mint
 * Used when we can't reach targetCR with desired mint, or when rounding errors occur
 */
function depositAllAndCalculateMint(
  candidate: VaultCandidate,
  targetCR: WAD
): { depositAmount: UNITS; mintAmount: WEI } {
  const depositAmount = candidate.potentialCollateral;
  const actualCollateral = candidate.currentCollateral + depositAmount;
  const actualCollateralValue = computeCollateralValueUSDST(
    actualCollateral,
    candidate.oraclePrice,
    candidate.vaultConfig.unitScale
  );
  const maxDebtRaw: WEI = (actualCollateralValue * WAD_UNIT) / targetCR;
  // Apply 1-unit buffer (matches "Available: x" calculation)
  const maxDebtFromCollateral: WEI = maxDebtRaw > 1n ? maxDebtRaw - 1n : 0n;
  const mintAmount = maxDebtFromCollateral > candidate.currentDebt
    ? maxDebtFromCollateral - candidate.currentDebt
    : 0n;
  
  return { depositAmount, mintAmount };
}

function allocate(
  candidate: VaultCandidate,
  remainingMint: WEI,
  targetCR: WAD,
  globalDebt: WEI,
  maximizeDeposit: boolean = false
): Allocation | 'DEBT_FLOOR_HIT' | 'DEBT_CEILING_HIT' | 'NO_HEADROOM' {
  let mintAmount: WEI = remainingMint;
  let depositAmount: UNITS = 0n;

  const currentCollateralValue: WEI = computeCollateralValueUSDST(candidate.currentCollateral, candidate.oraclePrice, candidate.vaultConfig.unitScale);
  const maxCollateral: UNITS = candidate.currentCollateral + candidate.potentialCollateral;
  const maxCollateralValue: WEI = computeCollateralValueUSDST(maxCollateral, candidate.oraclePrice, candidate.vaultConfig.unitScale);

  // STEP 1: Compute deposit and mint amounts
  if (maximizeDeposit) {
    // MAX mode: deposit everything, remainingMint is already the available headroom
    depositAmount = candidate.potentialCollateral;
    mintAmount = remainingMint;
  } else {
    // Normal mode: minimize deposit while achieving target mint
    const newDebt: WEI = candidate.currentDebt + mintAmount;
    const currentCR: WAD = newDebt > 0n ? (currentCollateralValue * WAD_UNIT) / newDebt : INF;

    if (currentCR >= targetCR) {
      depositAmount = 0n;
    } else {
      const maxCR: WAD = newDebt > 0n ? (maxCollateralValue * WAD_UNIT) / newDebt : INF;

      if (maxCR < targetCR) {
        // Can't reach targetCR even with all collateral - deposit all and reduce mint
        const result = depositAllAndCalculateMint(candidate, targetCR);
        depositAmount = result.depositAmount;
        mintAmount = result.mintAmount;
      } else {
        const requiredCollateral: UNITS = computeRequiredCollateralForCR(
          newDebt,
          targetCR,
          candidate.oraclePrice,
          candidate.vaultConfig.unitScale
        );
        const neededDeposit = requiredCollateral > candidate.currentCollateral
          ? requiredCollateral - candidate.currentCollateral
          : 0n;
        
        if (neededDeposit > candidate.potentialCollateral) {
          // Rounding error: deposit all available, reduce mint to maintain targetCR
          const result = depositAllAndCalculateMint(candidate, targetCR);
          depositAmount = result.depositAmount;
          mintAmount = result.mintAmount;
        } else {
          depositAmount = neededDeposit;
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Check debt ceiling
  // ═══════════════════════════════════════════════════════════════════════════
  if (candidate.vaultConfig.debtCeiling > 0n) {
    const ceilingHeadroom: WEI = candidate.vaultConfig.debtCeiling > globalDebt
      ? candidate.vaultConfig.debtCeiling - globalDebt
      : 0n;

    if (ceilingHeadroom <= 0n) {
      return 'DEBT_CEILING_HIT'; // No room under ceiling, skip
    }

    if (mintAmount > ceilingHeadroom) {
      // Cap mint to ceiling and recalculate deposit
      mintAmount = ceilingHeadroom;
      const newDebtAfterCap: WEI = candidate.currentDebt + mintAmount;
      const currentCRAfterCap: WAD = newDebtAfterCap > 0n
        ? (currentCollateralValue * WAD_UNIT) / newDebtAfterCap
        : INF;

      if (currentCRAfterCap >= targetCR) {
        depositAmount = 0n;
      } else {
        const maxCRAfterCap: WAD = newDebtAfterCap > 0n
          ? (maxCollateralValue * WAD_UNIT) / newDebtAfterCap
          : INF;

        if (maxCRAfterCap < targetCR) {
          return 'DEBT_CEILING_HIT'; // Can't achieve target CR with ceiling constraint
        }

        const requiredCollateral: UNITS = computeRequiredCollateralForCR(
          newDebtAfterCap,
          targetCR,
          candidate.oraclePrice,
          candidate.vaultConfig.unitScale
        );
        const neededDeposit = requiredCollateral > candidate.currentCollateral
          ? requiredCollateral - candidate.currentCollateral
          : 0n;
        
        if (neededDeposit > candidate.potentialCollateral) {
          // Rounding error: deposit all available, reduce mint to maintain targetCR
          const result = depositAllAndCalculateMint(candidate, targetCR);
          depositAmount = result.depositAmount;
          mintAmount = result.mintAmount;
        } else {
          depositAmount = neededDeposit;
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Check debt floor (simplified)
  // ═══════════════════════════════════════════════════════════════════════════
  const newTotalDebt: WEI = candidate.currentDebt + mintAmount;

  if (newTotalDebt > 0n && newTotalDebt < candidate.vaultConfig.debtFloor) {
    return 'DEBT_FLOOR_HIT';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Final validation - no headroom at target CR
  // ═══════════════════════════════════════════════════════════════════════════
  if (mintAmount <= 0n) {
    return 'NO_HEADROOM';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Apply final safety buffer for on-chain strict < check
  // Skip this buffer in MAX mode (maximizeDeposit=true) to avoid
  // underestimating the max mintable amount at the target HF.
  // ═══════════════════════════════════════════════════════════════════════════
  if (!maximizeDeposit) {
    const finalCollateral: UNITS = candidate.currentCollateral + depositAmount;
    const finalCollateralValue: UNITS = computeCollateralValueUSDST(finalCollateral, candidate.oraclePrice, candidate.vaultConfig.unitScale);
    // Use candidate.vaultConfig.minCR (on-chain constraint) not targetCR (user's risk buffer)
    const maxBorrowableOnChain: WEI = (finalCollateralValue * WAD_UNIT) / candidate.vaultConfig.minCR;
    const finalDebt: WEI = candidate.currentDebt + mintAmount;
    
    // Calculate safety buffer: 0.1% of mintAmount, minimum 1 unit
    const BUFFER_BPS: UNITS = 1n; // 0.1% = 1 basis point (1/1000)
    const BPS_SCALE: UNITS = 1000n;
    const percentBuffer: UNITS = (mintAmount * BUFFER_BPS) / BPS_SCALE;
    const safetyBuffer: UNITS = percentBuffer > 0n ? percentBuffer : 1n;
    
    // On-chain uses strict <, so finalDebt must be < maxBorrowableOnChain
    // Also subtract safety buffer to account for rate accumulator drift
    if (finalDebt + safetyBuffer >= maxBorrowableOnChain && mintAmount > 0n) {
      // Reduce mintAmount to satisfy strict < check with safety margin
      const safeMaxMint: WEI = maxBorrowableOnChain > candidate.currentDebt + safetyBuffer
        ? maxBorrowableOnChain - candidate.currentDebt - safetyBuffer - 1n 
        : 0n;
      mintAmount = safeMaxMint > 0n ? safeMaxMint : 0n;
    }

    if (mintAmount <= 0n) {
      return 'NO_HEADROOM';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL SANITY CHECK: Ensure deposit never exceeds available collateral
  // This guards against any edge cases or rounding errors we may have missed
  // ═══════════════════════════════════════════════════════════════════════════
  if (depositAmount > candidate.potentialCollateral) {
    console.warn('[allocate] SANITY CHECK TRIGGERED: depositAmount > potentialCollateral', {
      depositAmount,
      potentialCollateral: candidate.potentialCollateral,
      diff: depositAmount - candidate.potentialCollateral,
      asset: candidate.vaultConfig.symbol,
    });
    const result = depositAllAndCalculateMint(candidate, targetCR);
    depositAmount = result.depositAmount;
    mintAmount = result.mintAmount;
    
    if (mintAmount <= 0n) {
      return 'NO_HEADROOM';
    }
  }

  return {
    assetAddress: candidate.vaultConfig.assetAddress,
    mintAmount: mintAmount,
    depositAmount: depositAmount,
  };
}

