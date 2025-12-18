import { formatUnits } from "ethers";
import {
  RAY,
  WAD,
  INF,
  computeTargetCRWadFromRiskFactor,
  computeCurrentDebtUSD,
  computeGlobalDebtUSD,
  computeCollateralUSD,
  computeRequiredCollateralForCR,
} from "./cdpUtils";
import type { VaultCandidateInput, Allocation } from "./cdpTypes";

export type { VaultCandidateInput, Allocation };

interface VaultState {
  assetAddress: string;
  minCRWad: bigint;
  stabilityFeeRateAnnual: number;
  debtFloorUSD: bigint;
  debtCeilingUSD: bigint;
  unitScale: bigint;
  rateAccumulatorRay: bigint;
  totalScaledDebt: bigint;
  userVaultCollateral: bigint;
  userVaultScaledDebt: bigint;
  userAssetBalance: bigint;
  oraclePrice: bigint;
}

function toVaultState(c: VaultCandidateInput): VaultState {
  const rateAccumulatorRay = BigInt(c.rateAccumulator);
  const currentTotalDebtUSD = BigInt(c.currentTotalDebt);
  return {
    assetAddress: c.assetAddress,
    minCRWad: BigInt(c.minCR) * 10n ** 16n,
    stabilityFeeRateAnnual: c.stabilityFeeRate,
    debtFloorUSD: BigInt(c.debtFloor),
    debtCeilingUSD: BigInt(c.debtCeiling),
    unitScale: BigInt(c.unitScale),
    rateAccumulatorRay,
    totalScaledDebt: rateAccumulatorRay > 0n ? (currentTotalDebtUSD * RAY) / rateAccumulatorRay : 0n,
    userVaultCollateral: BigInt(c.collateralAmount),
    userVaultScaledDebt: BigInt(c.scaledDebt),
    userAssetBalance: BigInt(c.userNonCollateralBalance),
    oraclePrice: BigInt(c.oraclePrice),
  };
}

function computeMintHeadroom(
  vault: VaultState,
  targetCR: bigint,
  vaultDebtUSD: bigint,
  globalDebtUSD: bigint
): bigint {
  const maxCollateral = vault.userVaultCollateral + vault.userAssetBalance;
  const collateralUSD = computeCollateralUSD(maxCollateral, vault.oraclePrice, vault.unitScale);
  const maxDebtRaw = (collateralUSD * WAD) / targetCR;
  const maxDebtFromCollateral = maxDebtRaw > 0n ? maxDebtRaw - 1n : 0n;
  const headroomFromCollateral = maxDebtFromCollateral > vaultDebtUSD ? maxDebtFromCollateral - vaultDebtUSD : 0n;

  const headroomFromCeiling = vault.debtCeilingUSD === 0n
    ? INF
    : globalDebtUSD >= vault.debtCeilingUSD ? 0n : vault.debtCeilingUSD - globalDebtUSD;

  return headroomFromCollateral < headroomFromCeiling ? headroomFromCollateral : headroomFromCeiling;
}

function tryAllocateToVault(
  vault: VaultState,
  targetCR: bigint,
  vaultDebtUSD: bigint,
  globalDebtUSD: bigint,
  remainingMintUSD: bigint
): { plannedMint: bigint; plannedDeposit: bigint } | null {
  if ((vault.userAssetBalance <= 0n && vault.userVaultCollateral <= 0n) || vault.oraclePrice <= 0n) {
    return null;
  }

  const maxMintUSD = computeMintHeadroom(vault, targetCR, vaultDebtUSD, globalDebtUSD);
  if (maxMintUSD <= 0n) return null;

  const hasExistingDebt = vaultDebtUSD > 0n;
  if (!hasExistingDebt && vault.debtFloorUSD > 0n) {
    if (maxMintUSD < vault.debtFloorUSD || remainingMintUSD < vault.debtFloorUSD) return null;
  }

  let plannedMint = maxMintUSD < remainingMintUSD ? maxMintUSD : remainingMintUSD;
  if (plannedMint <= 0n) return null;

  let requiredCollateral = computeRequiredCollateralForCR(vaultDebtUSD + plannedMint, targetCR, vault.oraclePrice, vault.unitScale);
  let plannedDeposit = requiredCollateral > vault.userVaultCollateral ? requiredCollateral - vault.userVaultCollateral : 0n;

  if (plannedDeposit > vault.userAssetBalance) {
    const effectiveCollateral = vault.userVaultCollateral + vault.userAssetBalance;
    const effectiveCollateralUSD = computeCollateralUSD(effectiveCollateral, vault.oraclePrice, vault.unitScale);
    const maxDebtRaw = (effectiveCollateralUSD * WAD) / targetCR;
    const maxDebtEffective = maxDebtRaw > 0n ? maxDebtRaw - 1n : 0n;
    const effectiveHeadroom = maxDebtEffective > vaultDebtUSD ? maxDebtEffective - vaultDebtUSD : 0n;

    plannedMint = effectiveHeadroom < remainingMintUSD ? effectiveHeadroom : remainingMintUSD;
    if (plannedMint <= 0n) return null;

    requiredCollateral = computeRequiredCollateralForCR(vaultDebtUSD + plannedMint, targetCR, vault.oraclePrice, vault.unitScale);
    plannedDeposit = requiredCollateral > vault.userVaultCollateral ? requiredCollateral - vault.userVaultCollateral : 0n;
    if (plannedDeposit > vault.userAssetBalance) return null;
  }

  if (!hasExistingDebt && vault.debtFloorUSD > 0n && plannedMint < vault.debtFloorUSD) return null;

  return { plannedMint, plannedDeposit };
}

function buildAllocation(
  candidate: VaultCandidateInput,
  plannedMint: bigint,
  plannedDeposit: bigint
): Allocation {
  const decimals = candidate.collateralAmountDecimals || 18;
  const oraclePrice = parseFloat(formatUnits(BigInt(candidate.oraclePrice || "0"), 18));

  const depositAmount = plannedDeposit > 0n ? formatUnits(plannedDeposit, decimals) : "0";
  const depositAmountUSD = depositAmount !== "0" ? (parseFloat(depositAmount) * oraclePrice).toString() : "0";
  const mintAmount = plannedMint > 0n ? formatUnits(plannedMint, 18) : "0";

  const existingCollateral = parseFloat(formatUnits(BigInt(candidate.collateralAmount || "0"), decimals));
  const existingCollateralUSD = oraclePrice > 0 ? (existingCollateral * oraclePrice).toString() : "0";

  const userBalanceRaw = BigInt(candidate.userNonCollateralBalance || "0");
  const userBalance = userBalanceRaw > 0n ? formatUnits(userBalanceRaw, decimals) : "0";
  const userBalanceUSD = userBalance !== "0" && oraclePrice > 0 ? (parseFloat(userBalance) * oraclePrice).toString() : "0";

  return {
    assetAddress: candidate.assetAddress,
    symbol: candidate.symbol,
    depositAmount,
    depositAmountUSD,
    mintAmount,
    stabilityFeeRate: candidate.stabilityFeeRate || 0,
    existingCollateralUSD,
    userBalance,
    userBalanceUSD,
  };
}

export function getOptimalAllocations(
  targetMintUSD: bigint,
  riskFactor: number,
  candidates: VaultCandidateInput[]
): Allocation[] {
  if (targetMintUSD <= 0n || candidates.length === 0) return [];

  const candidateByAddress = new Map(candidates.map((c) => [c.assetAddress.toLowerCase(), c]));
  const vaults = candidates.map(toVaultState).sort((a, b) => a.stabilityFeeRateAnnual - b.stabilityFeeRateAnnual);

  const globalDebtByAsset = new Map<string, bigint>();
  for (const v of vaults) {
    globalDebtByAsset.set(v.assetAddress, computeGlobalDebtUSD(v.totalScaledDebt, v.rateAccumulatorRay));
  }

  const results: { assetAddress: string; plannedMint: bigint; plannedDeposit: bigint }[] = [];
  let remainingMintUSD = targetMintUSD;

  for (const vault of vaults) {
    if (remainingMintUSD <= 0n) break;

    const targetCR = computeTargetCRWadFromRiskFactor(vault.minCRWad, riskFactor);
    const vaultDebtUSD = computeCurrentDebtUSD(vault.userVaultScaledDebt, vault.rateAccumulatorRay);
    const globalDebtUSD = globalDebtByAsset.get(vault.assetAddress) || 0n;

    const allocation = tryAllocateToVault(vault, targetCR, vaultDebtUSD, globalDebtUSD, remainingMintUSD);
    if (!allocation) continue;

    results.push({ assetAddress: vault.assetAddress, ...allocation });
    globalDebtByAsset.set(vault.assetAddress, globalDebtUSD + allocation.plannedMint);
    remainingMintUSD -= allocation.plannedMint;
  }

  return results
    .filter((r) => r.plannedMint > 0n || r.plannedDeposit > 0n)
    .map((r) => {
      const candidate = candidateByAddress.get(r.assetAddress.toLowerCase());
      if (!candidate) throw new Error(`Candidate not found: ${r.assetAddress}`);
      return buildAllocation(candidate, r.plannedMint, r.plannedDeposit);
    })
    .sort((a, b) => parseFloat(b.mintAmount) - parseFloat(a.mintAmount));
}
