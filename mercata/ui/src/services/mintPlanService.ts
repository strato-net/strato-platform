import { formatUnits } from "ethers";
import {
  RAY,
  WAD,
  INF,
  convertAnnualPercentageToPerSecondRate,
  computeTargetCRWadFromRiskFactor,
  computeCurrentDebtUSD,
  computeGlobalDebtUSD,
  computeCollateralUSD,
  computeRequiredCollateralForCR,
} from "./cdpUtils";
import type {
  VaultInput,
  PlannedTransaction,
  MintPlanResult,
  VaultCandidateInput,
  Allocation,
} from "./cdpTypes";

export type {
  VaultInput,
  PlannedTransaction,
  MintPlanResult,
  VaultCandidateInput,
  Allocation,
};

export function convertVaultCandidatesToVaultInputs(candidates: VaultCandidateInput[]): VaultInput[] {
  return candidates.map((c) => {
    const rateAccumulatorRay = BigInt(c.rateAccumulator);
    const currentTotalDebtUSD = BigInt(c.currentTotalDebt);
    return {
      assetAddress: c.assetAddress,
      liquidationRatioWad: BigInt(c.liquidationRatio) * 10n ** 16n,
      minCRWad: BigInt(c.minCR) * 10n ** 16n,
      stabilityFeeRateRay: convertAnnualPercentageToPerSecondRate(c.stabilityFeeRate),
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
  });
}

export function getOptimalAllocations(
  targetMintUSD: bigint,
  riskFactor: number,
  candidates: VaultCandidateInput[]
): Allocation[] {
  if (targetMintUSD <= 0n || candidates.length === 0) return [];

  const vaultInputs = convertVaultCandidatesToVaultInputs(candidates);
  const sortedVaults = [...vaultInputs].sort((a, b) => a.stabilityFeeRateAnnual - b.stabilityFeeRateAnnual);
  let remainingMintUSD = targetMintUSD;
  const perAssetSummary: MintPlanResult["perAssetSummary"] = {};

  for (const vault of sortedVaults) {
    perAssetSummary[vault.assetAddress] = {
      plannedDeposit: 0n,
      plannedMint: 0n,
      effectiveTargetCRWad: computeTargetCRWadFromRiskFactor(vault.minCRWad, riskFactor),
      stabilityFeeRateRay: vault.stabilityFeeRateRay,
    };
  }

  const initialGlobalDebtByAsset = new Map<string, bigint>();
  for (const vault of sortedVaults) {
    initialGlobalDebtByAsset.set(vault.assetAddress, computeGlobalDebtUSD(vault.totalScaledDebt, vault.rateAccumulatorRay));
  }

  for (const vault of sortedVaults) {
    if (remainingMintUSD <= 0n) break;
    const targetCR = computeTargetCRWadFromRiskFactor(vault.minCRWad, riskFactor);
    const vaultDebtUSD = computeCurrentDebtUSD(vault.userVaultScaledDebt, vault.rateAccumulatorRay);
    let globalDebtUSD = initialGlobalDebtByAsset.get(vault.assetAddress) || 0n;

    if ((vault.userAssetBalance <= 0n && vault.userVaultCollateral <= 0n) || vault.oraclePrice <= 0n) continue;

    const maxCollateralIfAllDeposited = vault.userVaultCollateral + vault.userAssetBalance;
    const collUSDIfAllDeposited = computeCollateralUSD(maxCollateralIfAllDeposited, vault.oraclePrice, vault.unitScale);
    const maxDebtFromCollateralRaw = (collUSDIfAllDeposited * WAD) / targetCR;
    const maxDebtFromCollateral = maxDebtFromCollateralRaw > 0n ? maxDebtFromCollateralRaw - 1n : 0n;
    const headroomFromCollateral = maxDebtFromCollateral > vaultDebtUSD ? maxDebtFromCollateral - vaultDebtUSD : 0n;
    const headroomFromCeiling = vault.debtCeilingUSD === 0n ? INF : globalDebtUSD >= vault.debtCeilingUSD ? 0n : vault.debtCeilingUSD - globalDebtUSD;
    const maxExtraMintUSD = headroomFromCollateral < headroomFromCeiling ? headroomFromCollateral : headroomFromCeiling;

    if (maxExtraMintUSD <= 0n) continue;

    const hasExistingDebt = vaultDebtUSD > 0n;
    if (!hasExistingDebt && vault.debtFloorUSD > 0n) {
      if (maxExtraMintUSD < vault.debtFloorUSD || remainingMintUSD < vault.debtFloorUSD) continue;
    }

    let plannedMintHereUSD = maxExtraMintUSD < remainingMintUSD ? maxExtraMintUSD : remainingMintUSD;
    if (plannedMintHereUSD <= 0n) continue;

    const newDebtUSD = vaultDebtUSD + plannedMintHereUSD;
    const requiredCollateralRaw = computeRequiredCollateralForCR(newDebtUSD, targetCR, vault.oraclePrice, vault.unitScale);
    let extraCollateralNeeded = requiredCollateralRaw > vault.userVaultCollateral ? requiredCollateralRaw - vault.userVaultCollateral : 0n;

    if (extraCollateralNeeded > vault.userAssetBalance) {
      const effectiveTotalCollateral = vault.userVaultCollateral + vault.userAssetBalance;
      const collUSDEffective = computeCollateralUSD(effectiveTotalCollateral, vault.oraclePrice, vault.unitScale);
      const maxDebtEffectiveRaw = (collUSDEffective * WAD) / targetCR;
      const maxDebtEffective = maxDebtEffectiveRaw > 0n ? maxDebtEffectiveRaw - 1n : 0n;
      const effectiveHeadroomUSD = maxDebtEffective > vaultDebtUSD ? maxDebtEffective - vaultDebtUSD : 0n;
      plannedMintHereUSD = effectiveHeadroomUSD < remainingMintUSD ? effectiveHeadroomUSD : remainingMintUSD;

      if (plannedMintHereUSD <= 0n) continue;

      const newDebtUSD2 = vaultDebtUSD + plannedMintHereUSD;
      const requiredCollateralRaw2 = computeRequiredCollateralForCR(newDebtUSD2, targetCR, vault.oraclePrice, vault.unitScale);
      extraCollateralNeeded = requiredCollateralRaw2 > vault.userVaultCollateral ? requiredCollateralRaw2 - vault.userVaultCollateral : 0n;

      if (extraCollateralNeeded > vault.userAssetBalance) continue;
    }

    if (!hasExistingDebt && vault.debtFloorUSD > 0n && plannedMintHereUSD < vault.debtFloorUSD) continue;
    if (extraCollateralNeeded > 0n) perAssetSummary[vault.assetAddress].plannedDeposit += extraCollateralNeeded;
    perAssetSummary[vault.assetAddress].plannedMint += plannedMintHereUSD;
    globalDebtUSD += plannedMintHereUSD;
    initialGlobalDebtByAsset.set(vault.assetAddress, globalDebtUSD);
    remainingMintUSD -= plannedMintHereUSD;
  }

  const allocations: Allocation[] = [];
  const candidateByAddress = candidates.reduce<Record<string, VaultCandidateInput>>((acc, c) => {
    acc[c.assetAddress.toLowerCase()] = c;
    return acc;
  }, {});
  for (const [assetAddress, summary] of Object.entries(perAssetSummary)) {
    if (summary.plannedMint === 0n && summary.plannedDeposit === 0n) continue;
    const candidate = candidateByAddress[assetAddress.toLowerCase()];
    if (!candidate) continue;
    const decimals = candidate.collateralAmountDecimals || 18;
    const depositAmount = summary.plannedDeposit > 0n ? formatUnits(summary.plannedDeposit, decimals) : "0";
    const oraclePrice = parseFloat(formatUnits(BigInt(candidate.oraclePrice || "0"), 18));
    const depositAmountUSD = depositAmount !== "0" ? (parseFloat(depositAmount) * oraclePrice).toString() : "0";
    const mintAmount = summary.plannedMint > 0n ? formatUnits(summary.plannedMint, 18) : "0";
    const existingCollateralUSD = oraclePrice > 0 ? (parseFloat(formatUnits(BigInt(candidate.collateralAmount || "0"), decimals)) * oraclePrice).toString() : "0";
    const userBalance = candidate.userNonCollateralBalance && BigInt(candidate.userNonCollateralBalance) > 0n ? formatUnits(BigInt(candidate.userNonCollateralBalance), decimals) : "0";
    const userBalanceUSD = userBalance !== "0" && oraclePrice > 0 ? (parseFloat(userBalance) * oraclePrice).toString() : "0";
    allocations.push({
      assetAddress: candidate.assetAddress,
      symbol: candidate.symbol,
      depositAmount,
      depositAmountUSD,
      mintAmount,
      stabilityFeeRate: candidate.stabilityFeeRate || 0,
      existingCollateralUSD,
      userBalance,
      userBalanceUSD,
    });
  }

  return allocations.sort((a, b) => parseFloat(b.mintAmount) - parseFloat(a.mintAmount));
}
