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
    assetAddress: api.assetAddress,
    symbol: api.symbol,
    assetScale: BigInt(api.assetScale),
    minCR: BigInt(api.minCR),
    liquidationRatio: BigInt(api.liquidationRatio),
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
  minCR: bigint;                  // WAD format (1.5e18 = 150% CR) - min CR for user actions
  liquidationRatio: bigint;       // WAD format (1.5e18 = 150%) - liquidation threshold for HF calc
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
 * Always deposits ALL available collateral to maximize mint.
 */
export function getMaxAllocations(
  candidates: VaultCandidate[],
  riskBuffer: number
): Allocation[] {
  if (candidates.length === 0 || riskBuffer <= 0) return [];

  const allocations: Allocation[] = [];

  for (const candidate of candidates) {
    if ((candidate.potentialCollateral <= 0n && candidate.currentCollateral <= 0n) || candidate.oraclePrice <= 0n) {
      continue;
    }

    const targetCR = computeTargetCRWadFromRiskBuffer(candidate.minCR, riskBuffer, candidate.liquidationRatio);
    const headroom = computeHeadroom(candidate, targetCR);
    
    if (headroom <= 0n) continue;

    // For MAX mode: use headroom as target and force deposit of all collateral
    const result = allocate(candidate, headroom, targetCR, candidate.globalDebt, true);

    if (result !== 'DEBT_FLOOR_HIT' && result !== 'DEBT_CEILING_HIT' && result !== 'NO_HEADROOM' && result.mintAmount > 0n) {
      allocations.push(result);
    }
  }

  return allocations;
}

// Helper to compute headroom for a single candidate (used by both sorting and total headroom calculation)
// NOTE: Conservative buffer is applied because:
//   1. On-chain uses strict < check: require(currentDebt + amountUSD < maxBorrowableUSD)
//   2. Rate accumulator can drift between frontend calc and on-chain execution
//   3. Indexed currentDebt may be slightly stale
// Buffer: 0.1% (1/1000) of max debt, minimum 1 wei
function computeHeadroom(c: VaultCandidate, targetCR: bigint): bigint {
  const maxCollateral = c.currentCollateral + c.potentialCollateral;
  const collateralValue = computeCollateralUSD(maxCollateral, c.oraclePrice, c.assetScale);
  const maxDebtRaw = (collateralValue * WAD) / targetCR;
  
  // Apply conservative buffer: 0.1% of max debt, minimum 1 wei
  const BUFFER_BPS = 1n; // 0.1% = 1 basis point (1/1000)
  const BPS_SCALE = 1000n;
  const percentBuffer = (maxDebtRaw * BUFFER_BPS) / BPS_SCALE;
  const safetyBuffer = percentBuffer > 0n ? percentBuffer : 1n;
  
  const maxDebtFromCollateral = maxDebtRaw > safetyBuffer ? maxDebtRaw - safetyBuffer : 0n;
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

    const targetCR = computeTargetCRWadFromRiskBuffer(candidate.minCR, riskBuffer, candidate.liquidationRatio);
    const headroom = computeHeadroom(candidate, targetCR);
    totalHeadroom += headroom;
  }

  return totalHeadroom;
}

// Compute borrowing power: maxMintable at targetCR given collateral and current debt
function computeBorrowingPower(
  totalCollateral: bigint,
  currentDebt: bigint,
  oraclePrice: bigint,
  assetScale: bigint,
  targetCR: bigint
): bigint {
  const collateralValue = computeCollateralUSD(totalCollateral, oraclePrice, assetScale);
  const maxDebt = (collateralValue * WAD) / targetCR;
  return maxDebt > currentDebt ? maxDebt - currentDebt : 0n;
}

// Sort candidates: existing vaults first (by borrowing power), then potential vaults (by borrowing power)
const sortCandidates = (candidates: VaultCandidate[], riskBuffer: number): VaultCandidate[] => {
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
  
  // Sort existing vaults by borrowing power (descending)
  // Borrowing power = (currentCollateral + potentialCollateral) value / targetCR - currentDebt
  existingVaults.sort((a, b) => {
    const targetCRA = computeTargetCRWadFromRiskBuffer(a.minCR, riskBuffer, a.liquidationRatio);
    const targetCRB = computeTargetCRWadFromRiskBuffer(b.minCR, riskBuffer, b.liquidationRatio);
    const bpA = computeBorrowingPower(
      a.currentCollateral + a.potentialCollateral,
      a.currentDebt,
      a.oraclePrice,
      a.assetScale,
      targetCRA
    );
    const bpB = computeBorrowingPower(
      b.currentCollateral + b.potentialCollateral,
      b.currentDebt,
      b.oraclePrice,
      b.assetScale,
      targetCRB
    );
    if (bpA > bpB) return -1;
    if (bpA < bpB) return 1;
    return 0;
  });
  
  // Sort potential vaults by borrowing power (descending)
  // Borrowing power = potentialCollateral value / targetCR (no current debt)
  potentialVaults.sort((a, b) => {
    const targetCRA = computeTargetCRWadFromRiskBuffer(a.minCR, riskBuffer, a.liquidationRatio);
    const targetCRB = computeTargetCRWadFromRiskBuffer(b.minCR, riskBuffer, b.liquidationRatio);
    const bpA = computeBorrowingPower(
      a.potentialCollateral,
      0n,
      a.oraclePrice,
      a.assetScale,
      targetCRA
    );
    const bpB = computeBorrowingPower(
      b.potentialCollateral,
      0n,
      b.oraclePrice,
      b.assetScale,
      targetCRB
    );
    if (bpA > bpB) return -1;
    if (bpA < bpB) return 1;
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

    const targetCR = computeTargetCRWadFromRiskBuffer(candidate.minCR, riskBuffer, candidate.liquidationRatio);
    const currentGlobalDebt = globalDebtByAsset.get(candidate.assetAddress) ?? candidate.globalDebt;
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
      globalDebtByAsset.set(candidate.assetAddress, currentGlobalDebt + result.mintAmount);
    }
  }

  return { allocations, debtFloorHit, debtCeilingHit };
}

function allocate(
  candidate: VaultCandidate,
  remainingMint: bigint,
  targetCR: bigint,
  globalDebt: bigint,
  maximizeDeposit: boolean = false
): Allocation | 'DEBT_FLOOR_HIT' | 'DEBT_CEILING_HIT' | 'NO_HEADROOM' {
  let mintAmount = remainingMint;
  let depositAmount = 0n;

  const currentCollateralValue = computeCollateralUSD(
    candidate.currentCollateral,
    candidate.oraclePrice,
    candidate.assetScale
  );
  const maxCollateral = candidate.currentCollateral + candidate.potentialCollateral;
  const maxCollateralValue = computeCollateralUSD(maxCollateral, candidate.oraclePrice, candidate.assetScale);

  // STEP 1: Compute deposit and mint amounts
  if (maximizeDeposit) {
    // MAX mode: deposit everything and compute max mintable
    depositAmount = candidate.potentialCollateral;
    const maxDebtRaw = (maxCollateralValue * WAD) / targetCR;
    const BUFFER_BPS = 1n;
    const BPS_SCALE = 1000n;
    const percentBuffer = (maxDebtRaw * BUFFER_BPS) / BPS_SCALE;
    const safetyBuffer = percentBuffer > 0n ? percentBuffer : 1n;
    const maxDebtFromCollateral = maxDebtRaw > safetyBuffer ? maxDebtRaw - safetyBuffer : 0n;
    mintAmount = maxDebtFromCollateral > candidate.currentDebt
      ? maxDebtFromCollateral - candidate.currentDebt
      : 0n;
  } else {
    // Normal mode: minimize deposit while achieving target mint
    const newDebt = candidate.currentDebt + mintAmount;
    const currentCR = newDebt > 0n ? (currentCollateralValue * WAD) / newDebt : INF;

    if (currentCR >= targetCR) {
      depositAmount = 0n;
    } else {
      const maxCR = newDebt > 0n ? (maxCollateralValue * WAD) / newDebt : INF;

      if (maxCR < targetCR) {
        const maxDebtRaw = (maxCollateralValue * WAD) / targetCR;
        const BUFFER_BPS = 1n;
        const BPS_SCALE = 1000n;
        const percentBuffer = (maxDebtRaw * BUFFER_BPS) / BPS_SCALE;
        const safetyBuffer = percentBuffer > 0n ? percentBuffer : 1n;
        const maxDebtFromCollateral = maxDebtRaw > safetyBuffer ? maxDebtRaw - safetyBuffer : 0n;
        mintAmount = maxDebtFromCollateral > candidate.currentDebt
          ? maxDebtFromCollateral - candidate.currentDebt
          : 0n;
        depositAmount = candidate.potentialCollateral;
      } else {
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
  // STEP 4: Final validation - no headroom at target CR
  // ═══════════════════════════════════════════════════════════════════════════
  if (mintAmount <= 0n) {
    return 'NO_HEADROOM';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Apply final safety buffer for on-chain strict < check
  // On-chain: require(currentDebt + amountUSD < maxBorrowableUSD)
  // 
  // Apply conservative buffer to account for:
  // 1. Strict < check on-chain (vs >= or <=)
  // 2. Rate accumulator drift (interest accrual between frontend calc and execution)
  // 3. Potential staleness in indexed currentDebt value
  // 
  // Buffer: 0.1% (1/1000) of mint amount, minimum 1 wei
  // ═══════════════════════════════════════════════════════════════════════════
  const finalCollateral = candidate.currentCollateral + depositAmount;
  const finalCollateralValue = computeCollateralUSD(finalCollateral, candidate.oraclePrice, candidate.assetScale);
  // Use candidate.minCR (on-chain constraint) not targetCR (user's risk buffer)
  const maxBorrowableOnChain = (finalCollateralValue * WAD) / candidate.minCR;
  const finalDebt = candidate.currentDebt + mintAmount;
  
  // Calculate safety buffer: 0.1% of mintAmount, minimum 1 wei
  const BUFFER_BPS = 1n; // 0.1% = 1 basis point (1/1000)
  const BPS_SCALE = 1000n;
  const percentBuffer = (mintAmount * BUFFER_BPS) / BPS_SCALE;
  const safetyBuffer = percentBuffer > 0n ? percentBuffer : 1n;
  
  // On-chain uses strict <, so finalDebt must be < maxBorrowableOnChain
  // Also subtract safety buffer to account for rate accumulator drift
  if (finalDebt + safetyBuffer >= maxBorrowableOnChain && mintAmount > 0n) {
    // Reduce mintAmount to satisfy strict < check with safety margin
    const safeMaxMint = maxBorrowableOnChain > candidate.currentDebt + safetyBuffer
      ? maxBorrowableOnChain - candidate.currentDebt - safetyBuffer - 1n 
      : 0n;
    mintAmount = safeMaxMint > 0n ? safeMaxMint : 0n;
  }

  if (mintAmount <= 0n) {
    return 'NO_HEADROOM';
  }

  return {
    assetAddress: candidate.assetAddress,
    mintAmount,
    depositAmount,
  };
}

