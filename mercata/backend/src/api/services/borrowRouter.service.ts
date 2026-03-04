import { borrow as lendingBorrow, collateralAndBalance, getLoan, supplyCollateral as lendingSupplyCollateral } from "./lending.service";
import { deposit as cdpDeposit, getVaultCandidates, mint as cdpMint } from "./cdp.service";

type LendingCollateralInput = {
  asset: string;
  amount: string;
};

type PreviewBorrowRouteArgs = {
  accessToken: string;
  userAddress: string;
  amount: string;
  targetHealthFactor?: number;
  lendingCollateral?: LendingCollateralInput[];
};

type CdpCandidate = {
  assetAddress: string;
  symbol: string;
  unitScale: bigint;
  minCR: bigint;
  liquidationRatio: bigint;
  stabilityFeeRate: bigint;
  oraclePrice: bigint;
  currentCollateral: bigint;
  potentialCollateral: bigint;
  currentDebt: bigint;
  globalDebt: bigint;
  debtFloor: bigint;
  debtCeiling: bigint;
};

type CdpAllocation = {
  assetAddress: string;
  symbol: string;
  decimals: number;
  depositAmount: bigint;
  mintAmount: bigint;
  apr: number;
  collateralRatio: number;
  effectiveHealthFactor: number;
  collateralValueUSD: bigint;
  liquidationRatioWad: bigint;
  collateralAfter: bigint;
  debtAfter: bigint;
  unitScale: bigint;
  oraclePrice: bigint;
};

type LendingAssetCandidate = {
  assetAddress: string;
  symbol: string;
  decimals: bigint;
  price: bigint;
  liquidationThresholdBps: bigint;
  maxSupplyAmount: bigint;
};

type LendingAllocation = {
  assetAddress: string;
  symbol: string;
  decimals: number;
  supplyAmount: bigint;
  collateralValueUSD: bigint;
  ltWeightedValueUSD: bigint;
};

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31536000n;

const toBig = (value: string | number | bigint | undefined | null): bigint => {
  if (value === undefined || value === null) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const ceilDiv = (a: bigint, b: bigint): bigint => {
  if (b <= 0n) return 0n;
  return (a + b - 1n) / b;
};

const scaleToDecimals = (scale: bigint): number => {
  if (scale <= 1n) return 0;
  let current = 1n;
  let decimals = 0;
  while (current < scale && decimals < 36) {
    current *= 10n;
    decimals += 1;
  }
  return decimals;
};

const rpow = (x: bigint, n: bigint, ray: bigint): bigint => {
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
};

const annualPercentFromRateRay = (rateRay: bigint): number => {
  if (rateRay <= RAY) return 0;
  const annualFactorRay = rpow(rateRay, SECONDS_PER_YEAR, RAY);
  const factorMinusOne = annualFactorRay - RAY;
  return Number(factorMinusOne) / Number(RAY) * 100;
};

const clampHF = (hf: number | undefined): number => {
  if (!hf || !Number.isFinite(hf) || hf <= 1) return 2.1;
  return Math.max(1.01, Math.min(10, hf));
};

const buildCdpCandidates = (
  raw: any[],
  lendingCollateralByAsset: Map<string, bigint>
): CdpCandidate[] => {
  return raw
    .map((entry: any) => {
      const assetAddress = String(entry.assetAddress || "").toLowerCase();
      const reservedForLending = lendingCollateralByAsset.get(assetAddress) || 0n;
      const potentialRaw = toBig(entry.potentialCollateral);
      const potentialAdjusted = potentialRaw > reservedForLending ? (potentialRaw - reservedForLending) : 0n;
      return {
        assetAddress,
        symbol: String(entry.symbol || ""),
        unitScale: toBig(entry.assetScale) || WAD,
        minCR: toBig(entry.minCR),
        liquidationRatio: toBig(entry.liquidationRatio),
        stabilityFeeRate: toBig(entry.stabilityFeeRate),
        oraclePrice: toBig(entry.oraclePrice),
        currentCollateral: toBig(entry.currentCollateral),
        potentialCollateral: potentialAdjusted,
        currentDebt: toBig(entry.currentDebt),
        globalDebt: toBig(entry.globalDebt),
        debtFloor: toBig(entry.debtFloor),
        debtCeiling: toBig(entry.debtCeiling),
      };
    })
    .filter((c) => c.assetAddress && c.oraclePrice > 0n && c.unitScale > 0n);
};

const buildLendingCandidates = (
  collateralAssets: any[],
  lendingCollateral: LendingCollateralInput[] | undefined
): LendingAssetCandidate[] => {
  const manualCaps = new Map<string, bigint>();
  (lendingCollateral || []).forEach((item) => {
    const key = String(item.asset || "").toLowerCase();
    const amount = toBig(item.amount);
    if (!key || amount <= 0n) return;
    manualCaps.set(key, amount);
  });
  const useManualCaps = manualCaps.size > 0;

  return (collateralAssets || [])
    .map((asset: any) => {
      const assetAddress = String(asset.address || "").toLowerCase();
      const price = toBig(asset.assetPrice);
      const decimals = BigInt(asset.customDecimals ?? 18);
      const lt = toBig(asset.liquidationThreshold);
      const userBalance = toBig(asset.userBalance);
      if (!assetAddress || price <= 0n || lt <= 0n || decimals <= 0n) return null;
      const maxSupplyAmount = useManualCaps ? minBig(userBalance, manualCaps.get(assetAddress) || 0n) : userBalance;
      if (maxSupplyAmount <= 0n) return null;
      return {
        assetAddress,
        symbol: String(asset._symbol || ""),
        decimals,
        price,
        liquidationThresholdBps: lt,
        maxSupplyAmount,
      } as LendingAssetCandidate;
    })
    .filter((item): item is LendingAssetCandidate => Boolean(item));
};

const maxAdditionalLendingLTValue = (candidates: LendingAssetCandidate[]): bigint => {
  return candidates.reduce((sum, asset) => {
    const denominator = (10n ** asset.decimals) * 10000n;
    return sum + ((asset.maxSupplyAmount * asset.price * asset.liquidationThresholdBps) / denominator);
  }, 0n);
};

const planLendingCollateralForBorrow = (
  lendingAmount: bigint,
  currentDebt: bigint,
  currentLTWeightedCollateralUSD: bigint,
  targetHealthFactor: number,
  candidates: LendingAssetCandidate[]
): { allocations: LendingAllocation[]; reservedByAsset: Map<string, bigint>; addedLTWeightedUSD: bigint; addedCollateralValueUSD: bigint } => {
  if (lendingAmount <= 0n || candidates.length === 0) {
    return { allocations: [], reservedByAsset: new Map(), addedLTWeightedUSD: 0n, addedCollateralValueUSD: 0n };
  }

  const targetHFRaw = BigInt(Math.round(targetHealthFactor * 1e18));
  const debtAfter = currentDebt + lendingAmount;
  const requiredLTWeightedUSD = targetHFRaw > 0n ? (debtAfter * targetHFRaw) / WAD : 0n;
  let neededAdditionalLT = requiredLTWeightedUSD > currentLTWeightedCollateralUSD
    ? (requiredLTWeightedUSD - currentLTWeightedCollateralUSD)
    : 0n;

  const sorted = [...candidates].sort((a, b) => {
    if (a.liquidationThresholdBps === b.liquidationThresholdBps) {
      return Number(b.price - a.price);
    }
    return Number(b.liquidationThresholdBps - a.liquidationThresholdBps);
  });

  const allocations: LendingAllocation[] = [];
  const reservedByAsset = new Map<string, bigint>();

  for (const asset of sorted) {
    if (neededAdditionalLT <= 0n) break;
    const denominator = (10n ** asset.decimals) * 10000n;
    const perUnitLT = asset.price * asset.liquidationThresholdBps;
    if (perUnitLT <= 0n) continue;

    const targetAmount = ceilDiv(neededAdditionalLT * denominator, perUnitLT);
    const supplyAmount = minBig(targetAmount, asset.maxSupplyAmount);
    if (supplyAmount <= 0n) continue;

    const collateralValueUSD = (supplyAmount * asset.price) / (10n ** asset.decimals);
    const ltWeightedValueUSD = (supplyAmount * perUnitLT) / denominator;
    allocations.push({
      assetAddress: asset.assetAddress,
      symbol: asset.symbol,
      decimals: Number(asset.decimals),
      supplyAmount,
      collateralValueUSD,
      ltWeightedValueUSD,
    });
    reservedByAsset.set(asset.assetAddress, supplyAmount);
    neededAdditionalLT = neededAdditionalLT > ltWeightedValueUSD ? (neededAdditionalLT - ltWeightedValueUSD) : 0n;
  }

  const addedLTWeightedUSD = allocations.reduce((sum, a) => sum + a.ltWeightedValueUSD, 0n);
  const addedCollateralValueUSD = allocations.reduce((sum, a) => sum + a.collateralValueUSD, 0n);
  return { allocations, reservedByAsset, addedLTWeightedUSD, addedCollateralValueUSD };
};

const computeTargetCR = (candidate: CdpCandidate, targetHF: number): bigint => {
  const targetHFScaled = BigInt(Math.round(targetHF * 1e18));
  const fromHF = (candidate.liquidationRatio * targetHFScaled) / WAD;
  return fromHF > candidate.minCR ? fromHF : candidate.minCR;
};

const computeCdpHeadroom = (candidate: CdpCandidate, targetHF: number): bigint => {
  const targetCR = computeTargetCR(candidate, targetHF);
  const totalCollateral = candidate.currentCollateral + candidate.potentialCollateral;
  const collateralValue = (totalCollateral * candidate.oraclePrice) / candidate.unitScale;
  if (collateralValue <= 0n || targetCR <= 0n) return 0n;
  const maxDebt = (collateralValue * WAD) / targetCR;
  if (maxDebt <= candidate.currentDebt) return 0n;
  let headroom = maxDebt - candidate.currentDebt;
  if (candidate.debtCeiling > 0n) {
    const globalRoom = candidate.debtCeiling > candidate.globalDebt ? (candidate.debtCeiling - candidate.globalDebt) : 0n;
    headroom = headroom < globalRoom ? headroom : globalRoom;
  }
  if (headroom <= 0n) return 0n;
  if (candidate.currentDebt === 0n && candidate.debtFloor > 0n && headroom < candidate.debtFloor) return 0n;
  return headroom;
};

const planCdp = (targetMint: bigint, targetHF: number, candidates: CdpCandidate[]): {
  allocations: CdpAllocation[];
  totalMint: bigint;
  weightedApr: number;
  weightedCR: number;
  effectiveHFMin: number;
  capacity: bigint;
} => {
  if (targetMint <= 0n || candidates.length === 0) {
    return { allocations: [], totalMint: 0n, weightedApr: 0, weightedCR: 0, effectiveHFMin: Number.POSITIVE_INFINITY, capacity: 0n };
  }

  const sorted = [...candidates].sort((a, b) => annualPercentFromRateRay(a.stabilityFeeRate) - annualPercentFromRateRay(b.stabilityFeeRate));
  const capacity = sorted.reduce((sum, c) => sum + computeCdpHeadroom(c, targetHF), 0n);
  let remaining = targetMint;
  const allocations: CdpAllocation[] = [];

  for (const candidate of sorted) {
    if (remaining <= 0n) break;
    const headroom = computeCdpHeadroom(candidate, targetHF);
    if (headroom <= 0n) continue;

    let mintAmount = remaining < headroom ? remaining : headroom;
    if (candidate.currentDebt === 0n && candidate.debtFloor > 0n && mintAmount < candidate.debtFloor) {
      if (remaining >= candidate.debtFloor && headroom >= candidate.debtFloor) {
        mintAmount = candidate.debtFloor;
      } else {
        continue;
      }
    }

    const targetCR = computeTargetCR(candidate, targetHF);
    const newDebt = candidate.currentDebt + mintAmount;
    const requiredValue = (newDebt * targetCR) / WAD;
    const requiredCollateral = (requiredValue * candidate.unitScale) / candidate.oraclePrice;
    let depositAmount = requiredCollateral > candidate.currentCollateral ? (requiredCollateral - candidate.currentCollateral) : 0n;
    if (depositAmount > candidate.potentialCollateral) {
      depositAmount = candidate.potentialCollateral;
      const actualCollateral = candidate.currentCollateral + depositAmount;
      const actualValue = (actualCollateral * candidate.oraclePrice) / candidate.unitScale;
      const actualMaxDebt = (actualValue * WAD) / targetCR;
      const actualHeadroom = actualMaxDebt > candidate.currentDebt ? (actualMaxDebt - candidate.currentDebt) : 0n;
      mintAmount = mintAmount < actualHeadroom ? mintAmount : actualHeadroom;
      if (mintAmount <= 0n) continue;
    }

    const collateralAfter = candidate.currentCollateral + depositAmount;
    const collateralValueAfter = (collateralAfter * candidate.oraclePrice) / candidate.unitScale;
    const crWad = newDebt > 0n ? (collateralValueAfter * WAD) / newDebt : 0n;
    const collateralRatio = Number(crWad) / Number(WAD) * 100;
    const effectiveHF = candidate.liquidationRatio > 0n ? Number(crWad) / Number(candidate.liquidationRatio) : Number.POSITIVE_INFINITY;

    allocations.push({
      assetAddress: candidate.assetAddress,
      symbol: candidate.symbol,
      decimals: scaleToDecimals(candidate.unitScale),
      depositAmount,
      mintAmount,
      apr: annualPercentFromRateRay(candidate.stabilityFeeRate),
      collateralRatio,
      effectiveHealthFactor: effectiveHF,
      collateralValueUSD: collateralValueAfter,
      liquidationRatioWad: candidate.liquidationRatio,
      collateralAfter,
      debtAfter: newDebt,
      unitScale: candidate.unitScale,
      oraclePrice: candidate.oraclePrice,
    });
    remaining -= mintAmount;
  }

  const totalMint = allocations.reduce((sum, a) => sum + a.mintAmount, 0n);
  if (totalMint <= 0n) {
    return { allocations, totalMint, weightedApr: 0, weightedCR: 0, effectiveHFMin: Number.POSITIVE_INFINITY, capacity };
  }

  const weightedApr = allocations.reduce((sum, a) => sum + (Number(a.mintAmount) * a.apr), 0) / Number(totalMint);
  const weightedCR = allocations.reduce((sum, a) => sum + (Number(a.mintAmount) * a.collateralRatio), 0) / Number(totalMint);
  const effectiveHFMin = allocations.reduce((min, a) => Math.min(min, a.effectiveHealthFactor), Number.POSITIVE_INFINITY);
  return { allocations, totalMint, weightedApr, weightedCR, effectiveHFMin, capacity };
};

export const previewBorrowRoute = async (args: PreviewBorrowRouteArgs) => {
  const targetHealthFactor = clampHF(args.targetHealthFactor);
  const requestedAmount = toBig(args.amount);
  const requestedAmountSafe = requestedAmount > 0n ? requestedAmount : 0n;

  const [loan, collateralAssets, cdpCandidatesRaw] = await Promise.all([
    getLoan(args.accessToken, args.userAddress),
    collateralAndBalance(args.accessToken, args.userAddress),
    getVaultCandidates(args.accessToken, args.userAddress),
  ]);

  const currentDebt = toBig(loan?.totalAmountOwed);
  const currentLendingCollateralLTWeighted = toBig(loan?.totalCollateralValueUSD);
  const currentLendingCollateralValueUSD = toBig(loan?.totalCollateralValueSupplied);
  const lendingCandidates = buildLendingCandidates(collateralAssets || [], args.lendingCollateral);
  const additionalLendingLTCapacity = maxAdditionalLendingLTValue(lendingCandidates);
  const totalLendingCollateralLTWeightedCapacity = currentLendingCollateralLTWeighted + additionalLendingLTCapacity;
  const targetHFRaw = BigInt(Math.round(targetHealthFactor * 1e18));
  const maxDebtAtHF = targetHFRaw > 0n ? (totalLendingCollateralLTWeightedCapacity * WAD) / targetHFRaw : 0n;
  const lendingCapacity = maxDebtAtHF > currentDebt ? (maxDebtAtHF - currentDebt) : 0n;
  const lendingApr = Number(loan?.interestRate || 0) / 100;

  const rawCandidates = [...(cdpCandidatesRaw?.existingVaults || []), ...(cdpCandidatesRaw?.potentialVaults || [])];
  const cdpCandidatesUnreserved = buildCdpCandidates(rawCandidates, new Map());
  const cdpCapacityFull = planCdp((10n ** 30n), targetHealthFactor, cdpCandidatesUnreserved).capacity;
  const lendingCandidateByAsset = new Map(lendingCandidates.map((candidate) => [candidate.assetAddress, candidate]));
  const cdpHeadroomByApr = [...cdpCandidatesUnreserved]
    .map((candidate) => ({
      apr: annualPercentFromRateRay(candidate.stabilityFeeRate),
      headroom: computeCdpHeadroom(candidate, targetHealthFactor),
    }))
    .filter((item) => item.headroom > 0n)
    .sort((a, b) => a.apr - b.apr);
  const cdpCumulativeBreakpoints: bigint[] = [];
  let runningCdpHeadroom = 0n;
  for (const entry of cdpHeadroomByApr) {
    runningCdpHeadroom += entry.headroom;
    cdpCumulativeBreakpoints.push(runningCdpHeadroom);
  }

  const evaluateSplit = (targetAmount: bigint, candidateLendingAmount: bigint) => {
    const safeTarget = targetAmount > 0n ? targetAmount : 0n;
    const lendingAmount = minBig(candidateLendingAmount, safeTarget);
    const lendingPlan = planLendingCollateralForBorrow(
      lendingAmount,
      currentDebt,
      currentLendingCollateralLTWeighted,
      targetHealthFactor,
      lendingCandidates
    );
    const cdpCandidates = buildCdpCandidates(rawCandidates, lendingPlan.reservedByAsset);
    const cdpTarget = safeTarget > lendingAmount ? (safeTarget - lendingAmount) : 0n;
    const cdpPlan = planCdp(cdpTarget, targetHealthFactor, cdpCandidates);
    const totalRouted = lendingAmount + cdpPlan.totalMint;
    const feasible = totalRouted >= safeTarget;
    const shortfall = safeTarget > totalRouted ? (safeTarget - totalRouted) : 0n;

    const debtAfterLending = currentDebt + lendingAmount;
    const lendingLTWeightedAfter = currentLendingCollateralLTWeighted + lendingPlan.addedLTWeightedUSD;
    const lendingHF = debtAfterLending > 0n
      ? Number((lendingLTWeightedAfter * WAD) / debtAfterLending) / 1e18
      : Number.POSITIVE_INFINITY;
    const cdpHF = cdpPlan.totalMint > 0n ? cdpPlan.effectiveHFMin : Number.POSITIVE_INFINITY;
    const unifiedHF = Math.min(lendingHF, cdpHF);
    const blendedApr = totalRouted > 0n
      ? ((Number(lendingAmount) * lendingApr) + (Number(cdpPlan.totalMint) * cdpPlan.weightedApr)) / Number(totalRouted)
      : Number.POSITIVE_INFINITY;

    const projectedTotalDebt = currentDebt + lendingAmount + cdpPlan.totalMint;
    const projectedTotalCollateralValueUSD =
      currentLendingCollateralValueUSD +
      lendingPlan.addedCollateralValueUSD +
      cdpPlan.allocations.reduce((sum, a) => sum + a.collateralValueUSD, 0n);
    const projectedLtvPercent = projectedTotalCollateralValueUSD > 0n
      ? (Number(projectedTotalDebt) / Number(projectedTotalCollateralValueUSD)) * 100
      : 0;
    const liquidationDropPercent = Number.isFinite(unifiedHF) && unifiedHF > 1
      ? ((1 - (1 / unifiedHF)) * 100)
      : 0;
    let liquidationPriceUSD = 0;
    let liquidationSymbol = "USD";
    let liquidationDropPercentExact = liquidationDropPercent;

    if (lendingHF <= cdpHF && lendingPlan.allocations.length > 0) {
      const primaryLendingAllocation = lendingPlan.allocations.reduce((best, row) => {
        if (!best) return row;
        return row.ltWeightedValueUSD > best.ltWeightedValueUSD ? row : best;
      }, null as (LendingAllocation | null));
      if (primaryLendingAllocation) {
        const candidate = lendingCandidateByAsset.get(primaryLendingAllocation.assetAddress);
        if (candidate) {
          const otherLT = lendingLTWeightedAfter > primaryLendingAllocation.ltWeightedValueUSD
            ? (lendingLTWeightedAfter - primaryLendingAllocation.ltWeightedValueUSD)
            : 0n;
          const neededLTForLiquidation = debtAfterLending > otherLT ? (debtAfterLending - otherLT) : 0n;
          const denominator = primaryLendingAllocation.supplyAmount * candidate.liquidationThresholdBps;
          const liquidationPriceWei = denominator > 0n
            ? (neededLTForLiquidation * (10n ** candidate.decimals) * 10000n) / denominator
            : 0n;
          if (liquidationPriceWei > 0n) {
            liquidationPriceUSD = Number(liquidationPriceWei) / 1e18;
            liquidationSymbol = primaryLendingAllocation.symbol || "USD";
            if (candidate.price > 0n) {
              liquidationDropPercentExact = Math.max(
                0,
                (1 - (Number(liquidationPriceWei) / Number(candidate.price))) * 100
              );
            }
          }
        }
      }
    } else if (cdpPlan.allocations.length > 0) {
      const riskiestCdpAllocation = cdpPlan.allocations.reduce((best, row) => {
        if (!best) return row;
        return row.effectiveHealthFactor < best.effectiveHealthFactor ? row : best;
      }, null as (CdpAllocation | null));
      if (riskiestCdpAllocation) {
        const denominator = riskiestCdpAllocation.collateralAfter * WAD;
        const liquidationPriceWei = denominator > 0n
          ? (riskiestCdpAllocation.debtAfter * riskiestCdpAllocation.liquidationRatioWad * riskiestCdpAllocation.unitScale) / denominator
          : 0n;
        if (liquidationPriceWei > 0n) {
          liquidationPriceUSD = Number(liquidationPriceWei) / 1e18;
          liquidationSymbol = riskiestCdpAllocation.symbol || "USD";
          if (riskiestCdpAllocation.oraclePrice > 0n) {
            liquidationDropPercentExact = Math.max(
              0,
              (1 - (Number(liquidationPriceWei) / Number(riskiestCdpAllocation.oraclePrice))) * 100
            );
          }
        }
      }
    }

    return {
      lendingAmount,
      lendingPlan,
      cdpPlan,
      totalRouted,
      feasible,
      shortfall,
      lendingHF,
      cdpHF,
      unifiedHF,
      blendedApr,
      projectedLtvPercent,
      liquidationDropPercent: liquidationDropPercentExact,
      liquidationPriceUSD,
      liquidationSymbol,
    };
  };

  const optimizeForTarget = (targetAmount: bigint) => {
    const safeTarget = targetAmount > 0n ? targetAmount : 0n;
    const maxLendingForTarget = minBig(lendingCapacity, safeTarget);
    const splitCandidates = new Set<bigint>([0n, maxLendingForTarget]);
    const coarseSteps = 80n;
    for (let i = 1n; i < coarseSteps; i += 1n) {
      splitCandidates.add((maxLendingForTarget * i) / coarseSteps);
    }
    for (const cdpCum of cdpCumulativeBreakpoints) {
      const lendingFromBreakpoint = safeTarget > cdpCum ? (safeTarget - cdpCum) : 0n;
      splitCandidates.add(minBig(lendingFromBreakpoint, maxLendingForTarget));
    }
    const evaluated = Array.from(splitCandidates).map((candidate) => evaluateSplit(safeTarget, candidate));

    let selected = evaluated.find((item) => item.feasible) || null;
    if (selected) {
      for (const candidate of evaluated) {
        if (!candidate.feasible) continue;
        const betterApr = candidate.blendedApr < selected.blendedApr - 1e-9;
        const sameApr = Math.abs(candidate.blendedApr - selected.blendedApr) <= 1e-9;
        const betterHF = candidate.unifiedHF > selected.unifiedHF + 1e-9;
        const sameHF = Math.abs(candidate.unifiedHF - selected.unifiedHF) <= 1e-9;
        const lowerCollateral = candidate.lendingPlan.addedCollateralValueUSD < selected.lendingPlan.addedCollateralValueUSD;
        if (betterApr || (sameApr && (betterHF || (sameHF && lowerCollateral)))) {
          selected = candidate;
        }
      }
      let refinementStep = maxLendingForTarget / coarseSteps;
      for (let round = 0; round < 6 && refinementStep > 0n; round += 1) {
        const center = selected.lendingAmount;
        const localCandidates = new Set<bigint>([
          center,
          center > refinementStep ? (center - refinementStep) : 0n,
          minBig(maxLendingForTarget, center + refinementStep),
          center > (2n * refinementStep) ? (center - (2n * refinementStep)) : 0n,
          minBig(maxLendingForTarget, center + (2n * refinementStep)),
        ]);
        for (const lendingCandidate of localCandidates) {
          const candidate = evaluateSplit(safeTarget, lendingCandidate);
          if (!candidate.feasible) continue;
          const betterApr = candidate.blendedApr < selected.blendedApr - 1e-9;
          const sameApr = Math.abs(candidate.blendedApr - selected.blendedApr) <= 1e-9;
          const betterHF = candidate.unifiedHF > selected.unifiedHF + 1e-9;
          const sameHF = Math.abs(candidate.unifiedHF - selected.unifiedHF) <= 1e-9;
          const lowerCollateral = candidate.lendingPlan.addedCollateralValueUSD < selected.lendingPlan.addedCollateralValueUSD;
          if (betterApr || (sameApr && (betterHF || (sameHF && lowerCollateral)))) {
            selected = candidate;
          }
        }
        refinementStep /= 2n;
      }
    } else {
      selected = evaluated.reduce((best, candidate) => {
        if (!best) return candidate;
        if (candidate.totalRouted > best.totalRouted) return candidate;
        if (candidate.totalRouted === best.totalRouted && candidate.blendedApr < best.blendedApr) return candidate;
        return best;
      }, null as ((typeof evaluated)[number] | null));
    }
    return { selected, evaluated };
  };

  const requestedOptimization = optimizeForTarget(requestedAmountSafe);
  const selected = requestedOptimization.selected;
  const upperTargetForCapacity = lendingCapacity + cdpCapacityFull;
  let low = 0n;
  let high = upperTargetForCapacity;
  let maxTotalRouted = 0n;
  for (let i = 0; i < 28 && low <= high; i += 1) {
    const mid = (low + high) / 2n;
    const midOptimization = optimizeForTarget(mid);
    if (midOptimization.selected?.feasible) {
      maxTotalRouted = mid;
      low = mid + 1n;
    } else {
      if (mid === 0n) break;
      high = mid - 1n;
    }
  }

  const lendingAmount = selected?.lendingAmount || 0n;
  const lendingPlan = selected?.lendingPlan || planLendingCollateralForBorrow(0n, currentDebt, currentLendingCollateralLTWeighted, targetHealthFactor, lendingCandidates);
  const cdpPlan = selected?.cdpPlan || planCdp(0n, targetHealthFactor, cdpCandidatesUnreserved);
  const totalRouted = selected?.totalRouted || 0n;
  const feasible = selected?.feasible || false;
  const shortfall = selected?.shortfall || requestedAmountSafe;
  const lendingHF = selected?.lendingHF ?? Number.POSITIVE_INFINITY;
  const cdpHF = selected?.cdpHF ?? Number.POSITIVE_INFINITY;
  const unifiedHF = selected?.unifiedHF ?? targetHealthFactor;
  const blendedApr = selected?.blendedApr ?? 0;
  const projectedLtvPercent = selected?.projectedLtvPercent ?? 0;
  const liquidationDropPercent = selected?.liquidationDropPercent ?? 0;
  const liquidationPriceUSD = selected?.liquidationPriceUSD ?? 0;
  const liquidationSymbol = selected?.liquidationSymbol || "USD";

  return {
    requestedAmount: requestedAmountSafe.toString(),
    feasible,
    shortfall: shortfall.toString(),
    split: {
      lendingAmount: lendingAmount.toString(),
      cdpAmount: cdpPlan.totalMint.toString(),
      totalRouted: totalRouted.toString(),
      mechanisms: cdpPlan.totalMint > 0n && lendingAmount > 0n ? 2 : (totalRouted > 0n ? 1 : 0),
    },
    rates: {
      lendingApr,
      cdpApr: cdpPlan.weightedApr,
      blendedApr,
    },
    health: {
      targetHealthFactor,
      unifiedHealthFactor: Number.isFinite(unifiedHF) ? unifiedHF : targetHealthFactor,
      lendingHealthFactor: Number.isFinite(lendingHF) ? lendingHF : targetHealthFactor,
      cdpEffectiveHealthFactor: Number.isFinite(cdpHF) ? cdpHF : targetHealthFactor,
      cdpCollateralRatio: cdpPlan.weightedCR,
    },
    position: {
      projectedLtvPercent,
      liquidationDropPercent,
      liquidationHealthFactor: 1,
      liquidationPriceUSD,
      liquidationAssetSymbol: liquidationSymbol,
    },
    constraints: {
      lendingCapacity: lendingCapacity.toString(),
      cdpCapacity: cdpCapacityFull.toString(),
      totalCapacity: maxTotalRouted.toString(),
    },
    lendingAllocations: lendingPlan.allocations.map((a) => ({
      asset: a.assetAddress,
      symbol: a.symbol,
      decimals: a.decimals,
      supplyAmount: a.supplyAmount.toString(),
      collateralValueUSD: a.collateralValueUSD.toString(),
      ltWeightedValueUSD: a.ltWeightedValueUSD.toString(),
    })),
    cdpAllocations: cdpPlan.allocations.map((a) => ({
      asset: a.assetAddress,
      symbol: a.symbol,
      decimals: a.decimals,
      depositAmount: a.depositAmount.toString(),
      mintAmount: a.mintAmount.toString(),
      apr: a.apr,
      collateralRatio: a.collateralRatio,
      effectiveHealthFactor: a.effectiveHealthFactor,
      collateralValueUSD: a.collateralValueUSD.toString(),
      liquidationRatioWad: a.liquidationRatioWad.toString(),
      collateralAfter: a.collateralAfter.toString(),
      debtAfter: a.debtAfter.toString(),
    })),
  };
};

export const executeBorrowRoute = async (args: PreviewBorrowRouteArgs) => {
  const preview = await previewBorrowRoute(args);
  if (!preview.feasible) {
    throw new Error(`Requested amount exceeds routed capacity. Shortfall: ${preview.shortfall}`);
  }

  const steps: Array<{ step: string; status: "pending" | "completed" | "failed"; error?: string }> = [];
  let executedLendingBorrow = 0n;
  let executedCdpMint = 0n;
  try {
    for (const c of (preview.lendingAllocations || [])) {
      const amount = toBig(c.supplyAmount);
      if (amount <= 0n) continue;
      const stepName = `lending-supply-${String(c.asset).toLowerCase()}`;
      steps.push({ step: stepName, status: "pending" });
      await lendingSupplyCollateral(args.accessToken, args.userAddress, c.asset, amount.toString());
      steps[steps.length - 1].status = "completed";
    }

    const lendingAmount = toBig(preview.split.lendingAmount);
    if (lendingAmount > 0n) {
      steps.push({ step: "lending-borrow", status: "pending" });
      await lendingBorrow(args.accessToken, args.userAddress, lendingAmount.toString());
      steps[steps.length - 1].status = "completed";
      executedLendingBorrow = lendingAmount;
    }

    for (const allocation of preview.cdpAllocations) {
      const depositAmount = toBig(allocation.depositAmount);
      const mintAmount = toBig(allocation.mintAmount);
      if (depositAmount > 0n) {
        const stepName = `cdp-deposit-${allocation.asset}`;
        steps.push({ step: stepName, status: "pending" });
        await cdpDeposit(args.accessToken, args.userAddress, { asset: allocation.asset, amount: depositAmount.toString() });
        steps[steps.length - 1].status = "completed";
      }
      if (mintAmount > 0n) {
        const stepName = `cdp-mint-${allocation.asset}`;
        steps.push({ step: stepName, status: "pending" });
        await cdpMint(args.accessToken, args.userAddress, { asset: allocation.asset, amount: mintAmount.toString() });
        steps[steps.length - 1].status = "completed";
        executedCdpMint += mintAmount;
      }
    }

    return {
      status: "success",
      preview,
      steps,
      execution: {
        lendingBorrowed: executedLendingBorrow.toString(),
        cdpMinted: executedCdpMint.toString(),
        totalBorrowed: (executedLendingBorrow + executedCdpMint).toString(),
      },
    };
  } catch (error: any) {
    if (steps.length > 0 && steps[steps.length - 1].status === "pending") {
      steps[steps.length - 1].status = "failed";
      steps[steps.length - 1].error = error?.message || "Execution failed";
    }
    return {
      status: "partial_or_failed",
      preview,
      steps,
      error: error?.message || "Execution failed",
      execution: {
        lendingBorrowed: executedLendingBorrow.toString(),
        cdpMinted: executedCdpMint.toString(),
        totalBorrowed: (executedLendingBorrow + executedCdpMint).toString(),
        failedStep: steps[steps.length - 1]?.step || null,
      },
    };
  }
};

