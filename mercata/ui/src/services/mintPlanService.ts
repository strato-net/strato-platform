import { parseUnits, formatUnits } from "ethers";

const RAY = BigInt(10) ** BigInt(27);
const WAD = BigInt(10) ** BigInt(18);
const INF = BigInt(2) ** BigInt(255);
const SECONDS_PER_YEAR = 31536000n;

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

function convertAnnualPercentageToPerSecondRate(annualPercentage: number): bigint {
  const targetAnnualFactorRay = RAY + BigInt(Math.floor((annualPercentage / 100) * Number(RAY)));
  
  let low = RAY;
  let high = RAY + (RAY / 100n);
  
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
  
  const lowResult = rpow(low, SECONDS_PER_YEAR);
  const highResult = rpow(high, SECONDS_PER_YEAR);
  const lowDiff = lowResult > targetAnnualFactorRay ? lowResult - targetAnnualFactorRay : targetAnnualFactorRay - lowResult;
  const highDiff = highResult > targetAnnualFactorRay ? highResult - targetAnnualFactorRay : targetAnnualFactorRay - highResult;
  
  return lowDiff < highDiff ? low : high;
}

export enum RiskBand {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
}

export interface VaultInput {
  assetAddress: string;
  liquidationRatioWad: bigint;
  minCRWad: bigint;
  stabilityFeeRateRay: bigint;
  stabilityFeeRateAnnual: number; // Annual percentage for weighting (e.g., 1.5 for 1.5%)
  debtFloorUSD: bigint;
  debtCeilingUSD: bigint;
  unitScale: bigint;
  rateAccumulatorRay: bigint;
  totalScaledDebt: bigint;
  userVaultCollateral: bigint;
  userVaultScaledDebt: bigint;
  userAssetBalance: bigint;
  oraclePrice: bigint;
  oracleTimestamp: bigint;
  isSupportedAsset: boolean;
  isPaused: boolean;
}

export type PlannedTransaction =
  | {
      type: "DEPOSIT";
      assetAddress: string;
      amountCollateral: bigint;
    }
  | {
      type: "MINT";
      assetAddress: string;
      amountUSD: bigint;
    };

export interface MintPlanResult {
  transactions: PlannedTransaction[];
  totalPlannedMintUSD: bigint;
  targetMintUSD: bigint;
  perAssetSummary: {
    [assetAddress: string]: {
      plannedDeposit: bigint;
      plannedMint: bigint;
      effectiveTargetCRWad: bigint;
      stabilityFeeRateRay: bigint;
    };
  };
}

function isDummyAddress(address: string): boolean {
  const addr = address.toLowerCase().replace(/^0x/, "");
  if (addr.length !== 40) return false;
  const firstChar = addr[0];
  return addr.split("").every((char) => char === firstChar);
}

function riskBandToPremiumWad(riskBand: RiskBand): bigint {
  switch (riskBand) {
    case RiskBand.LOW:
      return 0n;
    case RiskBand.MEDIUM:
      return (2n * (10n ** 17n));
    case RiskBand.HIGH:
      return (4n * (10n ** 17n));
    default:
      return 0n;
  }
}

function computeTargetCRWad(minCRWad: bigint, riskBand: RiskBand): bigint {
  const premiumWad = riskBandToPremiumWad(riskBand);
  return (minCRWad * (WAD + premiumWad)) / WAD;
}

function computeTargetCRWadFromBuffer(minCRWad: bigint, bufferPercent: number): bigint {
  const bufferWad = (BigInt(Math.floor(bufferPercent * 100)) * WAD) / 10000n;
  return (minCRWad * (WAD + bufferWad)) / WAD;
}

function computeCurrentDebtUSD(
  userVaultScaledDebt: bigint,
  rateAccumulatorRay: bigint
): bigint {
  return (userVaultScaledDebt * rateAccumulatorRay) / RAY;
}

function computeGlobalDebtUSD(
  totalScaledDebt: bigint,
  rateAccumulatorRay: bigint
): bigint {
  return (totalScaledDebt * rateAccumulatorRay) / RAY;
}

function computeCollateralUSD(
  collateralAmount: bigint,
  oraclePrice: bigint,
  unitScale: bigint
): bigint {
  if (unitScale === 0n) return 0n;
  return (collateralAmount * oraclePrice) / unitScale;
}

function computeRequiredCollateralForCR(
  newDebtUSD: bigint,
  targetCRWad: bigint,
  oraclePrice: bigint,
  unitScale: bigint
): bigint {
  const collateralUSDRequired = (newDebtUSD * targetCRWad) / WAD;
  return (collateralUSDRequired * unitScale) / oraclePrice;
}

export function buildMintPlan(
  targetMintUSD: bigint,
  riskBand: RiskBand,
  vaultInputs: VaultInput[]
): MintPlanResult {
  const bufferPercent = riskBand === RiskBand.LOW ? 0 : riskBand === RiskBand.MEDIUM ? 20 : 40;
  return buildMintPlanWithBuffer(targetMintUSD, bufferPercent, vaultInputs);
}

export function buildMintPlanWithBuffer(
  targetMintUSD: bigint,
  bufferPercent: number,
  vaultInputs: VaultInput[]
): MintPlanResult {
  if (targetMintUSD <= 0n) {
    return {
      transactions: [],
      totalPlannedMintUSD: 0n,
      targetMintUSD,
      perAssetSummary: {},
    };
  }

  console.log("=== buildMintPlan: Filtering VaultInputs ===");
  console.log(`Total vaultInputs received: ${vaultInputs.length}`);
  
  const usableVaults: VaultInput[] = vaultInputs.filter((v) => {
    if (isDummyAddress(v.assetAddress)) {
      console.log(`Filtered out ${v.assetAddress}: dummy address`);
      return false;
    }
    if (v.assetAddress.toLowerCase() === USDST_ADDRESS.toLowerCase()) {
      console.log(`Filtered out ${v.assetAddress} (USDST): cannot use USDST as collateral`);
      return false;
    }
    const hasCollateralOrBalance =
      v.userVaultCollateral > 0n || v.userAssetBalance > 0n;
    if (!hasCollateralOrBalance) {
      console.log(`Filtered out ${v.assetAddress}: no collateral or balance`);
      return false;
    }
    if (!v.isSupportedAsset) {
      console.log(`Filtered out ${v.assetAddress}: not supported`);
      return false;
    }
    if (v.isPaused) {
      console.log(`Filtered out ${v.assetAddress}: paused`);
      return false;
    }
    if (v.oraclePrice <= 0n) {
      console.log(`Filtered out ${v.assetAddress}: no oracle price (${v.oraclePrice})`);
      return false;
    }
    if (v.unitScale <= 0n) {
      console.log(`Filtered out ${v.assetAddress}: invalid unitScale (${v.unitScale})`);
      return false;
    }
    console.log(`✓ Usable vault: ${v.assetAddress}, collateral=${v.userVaultCollateral}, balance=${v.userAssetBalance}, price=${v.oraclePrice}`);
    return true;
  });

  console.log(`=== Usable Vaults: ${usableVaults.length} ===`);
  usableVaults.forEach((v, idx) => {
    console.log(`${idx + 1}. ${v.assetAddress}: collateral=${v.userVaultCollateral}, balance=${v.userAssetBalance}`);
  });

  if (usableVaults.length === 0) {
    return {
      transactions: [],
      totalPlannedMintUSD: 0n,
      targetMintUSD,
      perAssetSummary: {},
    };
  }

  type WorkingVaultState = {
    assetAddress: string;
    targetCRWad: bigint;
    stabilityFeeRateRay: bigint;
    stabilityFeeRateAnnual: number; // Annual percentage for weighting
    debtFloorUSD: bigint;
    debtCeilingUSD: bigint;
    unitScale: bigint;
    currentVaultCollateral: bigint;
    currentVaultDebtUSD: bigint;
    currentAssetBalance: bigint;
    currentGlobalDebtUSD: bigint;
    oraclePrice: bigint;
  };

  const workingVaults: WorkingVaultState[] = usableVaults.map((v) => {
    const targetCR = computeTargetCRWadFromBuffer(v.minCRWad, bufferPercent);
    const currentDebtUSD = computeCurrentDebtUSD(
      v.userVaultScaledDebt,
      v.rateAccumulatorRay
    );
    const globalDebtUSD = computeGlobalDebtUSD(
      v.totalScaledDebt,
      v.rateAccumulatorRay
    );

    return {
      assetAddress: v.assetAddress,
      targetCRWad: targetCR,
      stabilityFeeRateRay: v.stabilityFeeRateRay,
      stabilityFeeRateAnnual: v.stabilityFeeRateAnnual,
      debtFloorUSD: v.debtFloorUSD,
      debtCeilingUSD: v.debtCeilingUSD,
      unitScale: v.unitScale,
      currentVaultCollateral: v.userVaultCollateral,
      currentVaultDebtUSD: currentDebtUSD,
      currentAssetBalance: v.userAssetBalance,
      currentGlobalDebtUSD: globalDebtUSD,
      oraclePrice: v.oraclePrice,
    };
  });

  // Sort by stability fee rate (lowest first) for proportional allocation
  workingVaults.sort((a, b) => {
    if (a.stabilityFeeRateRay < b.stabilityFeeRateRay) return -1;
    if (a.stabilityFeeRateRay > b.stabilityFeeRateRay) return 1;
    return 0;
  });

  let remainingMintUSD: bigint = targetMintUSD;
  const transactions: PlannedTransaction[] = [];
  const perAssetSummary: MintPlanResult["perAssetSummary"] = {};

  for (const w of workingVaults) {
    perAssetSummary[w.assetAddress] = {
      plannedDeposit: 0n,
      plannedMint: 0n,
      effectiveTargetCRWad: w.targetCRWad,
      stabilityFeeRateRay: w.stabilityFeeRateRay,
    };
  }

  // First pass: Calculate max capacity for each vault and proportional allocation
  type VaultCapacity = {
    vault: WorkingVaultState;
    maxMintCapacity: bigint;
    weight: bigint; // Inverse of stability fee rate (higher weight = lower fee = preferred)
    plannedMint: bigint; // Calculated proportional allocation
  };

  const vaultCapacities: VaultCapacity[] = [];

  // Calculate capacities and weights
  for (const w of workingVaults) {
    const vaultCollateral = w.currentVaultCollateral;
    const vaultDebtUSD = w.currentVaultDebtUSD;
    const assetBalance = w.currentAssetBalance;
    const globalDebtUSD = w.currentGlobalDebtUSD;

    const price = w.oraclePrice;
    const targetCR = w.targetCRWad;
    const debtCeiling = w.debtCeilingUSD;
    const unitScale = w.unitScale;

    if (assetBalance <= 0n && vaultCollateral <= 0n) {
      continue;
    }
    if (price <= 0n) {
      continue;
    }

    const maxCollateralIfAllDeposited = vaultCollateral + assetBalance;
    const collUSDIfAllDeposited = computeCollateralUSD(
      maxCollateralIfAllDeposited,
      price,
      unitScale
    );
    const maxDebtFromCollateral = (collUSDIfAllDeposited * WAD) / targetCR;

    let headroomFromCollateral: bigint = 0n;
    if (maxDebtFromCollateral > vaultDebtUSD) {
      headroomFromCollateral = maxDebtFromCollateral - vaultDebtUSD;
    }

    let headroomFromCeiling: bigint;
    if (debtCeiling === 0n) {
      headroomFromCeiling = INF;
    } else if (globalDebtUSD >= debtCeiling) {
      headroomFromCeiling = 0n;
    } else {
      headroomFromCeiling = debtCeiling - globalDebtUSD;
    }

    const maxExtraMintUSD = headroomFromCollateral < headroomFromCeiling
      ? headroomFromCollateral
      : headroomFromCeiling;

    if (maxExtraMintUSD <= 0n) {
      continue;
    }

    // Weight by inverse of annual stability fee rate (lower fee = higher weight)
    // Use 10000 as base for precision: weight = 10000 / annualFee
    // This ensures ETHST (1.5%) gets weight ~6667 vs WBTCST (1.75%) gets weight ~5714
    const weight = w.stabilityFeeRateAnnual > 0
      ? BigInt(Math.floor((10000 / w.stabilityFeeRateAnnual) * 1000)) // Scale by 1000 for precision
      : 0n;

    vaultCapacities.push({
      vault: w,
      maxMintCapacity: maxExtraMintUSD,
      weight,
      plannedMint: 0n, // Will be calculated below
    });
  }

  // Calculate total weighted capacity and proportional allocations
  let totalWeightedCapacity = 0n;
  for (const vc of vaultCapacities) {
    totalWeightedCapacity += vc.maxMintCapacity * vc.weight;
  }

  // Calculate proportional allocations
  if (totalWeightedCapacity > 0n) {
    for (const vc of vaultCapacities) {
      // Allocate proportionally: (capacity * weight / totalWeightedCapacity) * targetMintUSD
      const weightedShare = (vc.maxMintCapacity * vc.weight * targetMintUSD) / totalWeightedCapacity;
      vc.plannedMint = weightedShare < vc.maxMintCapacity 
        ? weightedShare 
        : vc.maxMintCapacity;
    }
  }

  // Second pass: Execute allocations
  for (const vc of vaultCapacities) {
    if (remainingMintUSD <= 0n) {
      break;
    }

    const w = vc.vault;
    let vaultCollateral = w.currentVaultCollateral;
    let vaultDebtUSD = w.currentVaultDebtUSD;
    let assetBalance = w.currentAssetBalance;
    let globalDebtUSD = w.currentGlobalDebtUSD;

    const price = w.oraclePrice;
    const targetCR = w.targetCRWad;
    const debtFloor = w.debtFloorUSD;
    const unitScale = w.unitScale;

    // Use proportional allocation, but don't exceed remaining amount
    let plannedMintHereUSD = vc.plannedMint < remainingMintUSD
      ? vc.plannedMint
      : remainingMintUSD;

    // Respect debt floor
    const hasExistingDebt = vaultDebtUSD > 0n;
    if (!hasExistingDebt && debtFloor > 0n) {
      if (plannedMintHereUSD > 0n && plannedMintHereUSD < debtFloor) {
        if (remainingMintUSD >= debtFloor) {
          plannedMintHereUSD = debtFloor;
        } else {
          continue;
        }
      }
    }

    if (plannedMintHereUSD <= 0n) {
      continue;
    }

    const newDebtUSD = vaultDebtUSD + plannedMintHereUSD;
    const requiredCollateralRaw = computeRequiredCollateralForCR(
      newDebtUSD,
      targetCR,
      price,
      unitScale
    );

    let extraCollateralNeeded: bigint = 0n;
    if (requiredCollateralRaw > vaultCollateral) {
      extraCollateralNeeded = requiredCollateralRaw - vaultCollateral;
    }

    if (extraCollateralNeeded > assetBalance) {
      const effectiveTotalCollateral = vaultCollateral + assetBalance;
      const collUSDEffective = computeCollateralUSD(
        effectiveTotalCollateral,
        price,
        unitScale
      );
      const maxDebtEffective = (collUSDEffective * WAD) / targetCR;

      let effectiveHeadroomUSD: bigint = 0n;
      if (maxDebtEffective > vaultDebtUSD) {
        effectiveHeadroomUSD = maxDebtEffective - vaultDebtUSD;
      }

      plannedMintHereUSD =
        effectiveHeadroomUSD < remainingMintUSD
          ? effectiveHeadroomUSD
          : remainingMintUSD;

      if (plannedMintHereUSD <= 0n) {
        continue;
      }

      const newDebtUSD2 = vaultDebtUSD + plannedMintHereUSD;
      const requiredCollateralRaw2 = computeRequiredCollateralForCR(
        newDebtUSD2,
        targetCR,
        price,
        unitScale
      );

      if (requiredCollateralRaw2 > vaultCollateral) {
        extraCollateralNeeded = requiredCollateralRaw2 - vaultCollateral;
      } else {
        extraCollateralNeeded = 0n;
      }

      if (extraCollateralNeeded > assetBalance) {
        continue;
      }
    }

    if (extraCollateralNeeded > 0n) {
      transactions.push({
        type: "DEPOSIT",
        assetAddress: w.assetAddress,
        amountCollateral: extraCollateralNeeded,
      });
      perAssetSummary[w.assetAddress].plannedDeposit += extraCollateralNeeded;
    }

    transactions.push({
      type: "MINT",
      assetAddress: w.assetAddress,
      amountUSD: plannedMintHereUSD,
    });
    perAssetSummary[w.assetAddress].plannedMint += plannedMintHereUSD;

    vaultCollateral += extraCollateralNeeded;
    assetBalance -= extraCollateralNeeded;
    vaultDebtUSD += plannedMintHereUSD;
    globalDebtUSD += plannedMintHereUSD;

    w.currentVaultCollateral = vaultCollateral;
    w.currentAssetBalance = assetBalance;
    w.currentVaultDebtUSD = vaultDebtUSD;
    w.currentGlobalDebtUSD = globalDebtUSD;

    remainingMintUSD -= plannedMintHereUSD;
  }

  let totalPlannedMintUSD: bigint = 0n;
  for (const [asset, summary] of Object.entries(perAssetSummary)) {
    totalPlannedMintUSD += summary.plannedMint;
  }

  return {
    transactions,
    totalPlannedMintUSD,
    targetMintUSD,
    perAssetSummary,
  };
}

export interface ConversionAssetConfig {
  asset: string;
  symbol: string;
  liquidationRatio: number;
  minCR: number;
  stabilityFeeRate: number;
  debtFloor: string;
  debtCeiling: string;
  unitScale: string;
  isPaused: boolean;
  isSupported?: boolean;
}

export interface ConversionVaultData {
  asset: string;
  collateralAmount: string;
  collateralAmountDecimals?: number;
  scaledDebt: string;
  rateAccumulator: string;
}

export interface ConversionTokenInfo {
  address?: string;
  balance?: string;
  decimals?: number;
}

export interface ConversionPriceMap {
  [assetAddress: string]: string;
}

export interface ConversionGlobalDebtInfo {
  [assetAddress: string]: {
    currentTotalDebt: string;
  };
}

const USDST_ADDRESS = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";

export function convertToVaultInputs(
  assets: ConversionAssetConfig[],
  vaults: ConversionVaultData[],
  activeTokens: ConversionTokenInfo[],
  prices: ConversionPriceMap,
  globalDebtInfo: ConversionGlobalDebtInfo
): VaultInput[] {
  const vaultInputs: VaultInput[] = [];
  const processedAssets = new Set<string>();

  const filteredVaults = vaults.filter(v => !isDummyAddress(v.asset) && v.asset.toLowerCase() !== USDST_ADDRESS.toLowerCase());
  console.log("=== User Vaults ===");
  console.log("Total vaults fetched:", filteredVaults.length);
  filteredVaults.forEach((v, idx) => {
    const assetConfig = assets.find(a => a.asset.toLowerCase() === v.asset.toLowerCase());
    console.log(`${idx + 1}. Asset: ${v.asset} (${assetConfig?.symbol || 'N/A'}), Collateral: ${v.collateralAmount || "0"}, Debt: ${v.scaledDebt || "0"}`);
  });

  const userAssetsWithBalance = activeTokens.filter(t => {
    if (!t.address || isDummyAddress(t.address)) return false;
    const balance = BigInt(t.balance || "0");
    return balance > 0n;
  });
  console.log("=== User Assets with Balance ===");
  console.log("Total assets with balance:", userAssetsWithBalance.length);
  userAssetsWithBalance.forEach((t, idx) => {
    const assetConfig = assets.find(a => a.asset.toLowerCase() === t.address?.toLowerCase());
    const tokenInfo = t as ConversionTokenInfo & { symbol?: string; name?: string };
    const tokenSymbol = tokenInfo.symbol || tokenInfo.name;
    console.log(`${idx + 1}. Address: ${t.address} (${assetConfig?.symbol || tokenSymbol || 'N/A'}), Balance: ${t.balance || "0"}, Decimals: ${t.decimals || 18}`);
  });

  const assetByAddress = assets.reduce<Record<string, ConversionAssetConfig>>((acc, a) => {
    if (!isDummyAddress(a.asset)) {
      acc[a.asset.toLowerCase()] = a;
    }
    return acc;
  }, {});

  const tokensByAddress = activeTokens.reduce<
    Record<string, ConversionTokenInfo>
  >((acc, t) => {
    if (t.address && !isDummyAddress(t.address)) {
      acc[t.address.toLowerCase()] = t;
    }
    return acc;
  }, {});

  const supportedUnpausedAssets = new Set<string>();
  console.log("=== Supported/Unpaused Assets ===");
  for (const asset of assets) {
    if (isDummyAddress(asset.asset)) {
      continue;
    }
    const isSupported = asset.isSupported ?? true;
    const isPaused = asset.isPaused ?? false;
    if (isSupported && !isPaused) {
      supportedUnpausedAssets.add(asset.asset.toLowerCase());
      console.log(`Supported/Unpaused: ${asset.asset} (${asset.symbol || 'N/A'})`);
    }
  }
  console.log(`Total supported/unpaused assets: ${supportedUnpausedAssets.size}`);

  for (const vault of vaults) {
    if (isDummyAddress(vault.asset)) {
      continue;
    }
    
    const assetLower = vault.asset.toLowerCase();
    const asset = assetByAddress[assetLower];
    if (!asset) {
      continue;
    }
    
    processedAssets.add(assetLower);
    
    const tokenInfo = tokensByAddress[assetLower];
    const userVaultCollateral = BigInt(vault.collateralAmount || "0");
    const userAssetBalance = tokenInfo
      ? BigInt(tokenInfo.balance || "0")
      : 0n;
    
    const decimals = vault.collateralAmountDecimals || tokenInfo?.decimals || 18;
    const priceStr = prices[assetLower] || "0";
    const oraclePrice = BigInt(priceStr || "0");
    const userVaultScaledDebt = BigInt(vault.scaledDebt || "0");
    const rateAccumulatorRay = BigInt(vault.rateAccumulator || RAY.toString());
    
    const globalDebtInfoForAsset = globalDebtInfo[assetLower];
    const currentTotalDebtUSD = globalDebtInfoForAsset
      ? BigInt(globalDebtInfoForAsset.currentTotalDebt || "0")
      : 0n;
    const totalScaledDebt = rateAccumulatorRay > 0n
      ? (currentTotalDebtUSD * RAY) / rateAccumulatorRay
      : 0n;
    
    const minCRPercent = asset.minCR || 200;
    const minCRWad = (BigInt(minCRPercent) * BigInt(10) ** BigInt(16));
    
    const liquidationRatioPercent = asset.liquidationRatio || 150;
    const liquidationRatioWad = (BigInt(liquidationRatioPercent) * BigInt(10) ** BigInt(16));
    
    const stabilityFeeRateRay = asset.stabilityFeeRate
      ? convertAnnualPercentageToPerSecondRate(asset.stabilityFeeRate)
      : RAY;
    const stabilityFeeRateAnnual = asset.stabilityFeeRate || 0;
    
    const debtFloorUSD = BigInt(asset.debtFloor || "0");
    const debtCeilingUSD = BigInt(asset.debtCeiling || "0");
    const unitScale = BigInt(asset.unitScale || WAD.toString());
    
    vaultInputs.push({
      assetAddress: asset.asset,
      liquidationRatioWad,
      minCRWad,
      stabilityFeeRateRay,
      stabilityFeeRateAnnual,
      debtFloorUSD,
      debtCeilingUSD,
      unitScale,
      rateAccumulatorRay,
      totalScaledDebt,
      userVaultCollateral,
      userVaultScaledDebt,
      userAssetBalance,
      oraclePrice,
      oracleTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      isSupportedAsset: asset.isSupported ?? true,
      isPaused: asset.isPaused ?? false,
    });
  }

  console.log("=== Processing User Assets for New Vaults ===");
  for (const token of activeTokens) {
    if (!token.address || isDummyAddress(token.address)) {
      continue;
    }
    
    const assetLower = token.address.toLowerCase();
    if (assetLower === USDST_ADDRESS.toLowerCase()) {
      console.log(`Skipping ${assetLower} (USDST): cannot use USDST as collateral`);
      continue;
    }
    
    if (processedAssets.has(assetLower)) {
      console.log(`Skipping ${assetLower}: already has vault`);
      continue;
    }
    
    if (!supportedUnpausedAssets.has(assetLower)) {
      console.log(`Skipping ${assetLower}: not supported/unpaused`);
      continue;
    }
    
    const asset = assetByAddress[assetLower];
    if (!asset) {
      console.log(`Skipping ${assetLower}: not in assets config`);
      continue;
    }
    
    const userAssetBalance = BigInt(token.balance || "0");
    if (userAssetBalance === 0n) {
      console.log(`Skipping ${assetLower}: zero balance`);
      continue;
    }
    
    console.log(`Adding new vault entry for ${assetLower} (${asset.symbol || 'N/A'}): balance=${userAssetBalance}`);
    processedAssets.add(assetLower);
    
    const priceStr = prices[assetLower] || "0";
    const oraclePrice = BigInt(priceStr || "0");
    const rateAccumulatorRay = RAY;
    
    const globalDebtInfoForAsset = globalDebtInfo[assetLower];
    const currentTotalDebtUSD = globalDebtInfoForAsset
      ? BigInt(globalDebtInfoForAsset.currentTotalDebt || "0")
      : 0n;
    const totalScaledDebt = rateAccumulatorRay > 0n
      ? (currentTotalDebtUSD * RAY) / rateAccumulatorRay
      : 0n;
    
    const minCRPercent = asset.minCR || 200;
    const minCRWad = (BigInt(minCRPercent) * BigInt(10) ** BigInt(16));
    
    const liquidationRatioPercent = asset.liquidationRatio || 150;
    const liquidationRatioWad = (BigInt(liquidationRatioPercent) * BigInt(10) ** BigInt(16));
    
    const stabilityFeeRateRay = asset.stabilityFeeRate
      ? convertAnnualPercentageToPerSecondRate(asset.stabilityFeeRate)
      : RAY;
    const stabilityFeeRateAnnual = asset.stabilityFeeRate || 0;
    
    const debtFloorUSD = BigInt(asset.debtFloor || "0");
    const debtCeilingUSD = BigInt(asset.debtCeiling || "0");
    const unitScale = BigInt(asset.unitScale || WAD.toString());
    
    vaultInputs.push({
      assetAddress: asset.asset,
      liquidationRatioWad,
      minCRWad,
      stabilityFeeRateRay,
      stabilityFeeRateAnnual,
      debtFloorUSD,
      debtCeilingUSD,
      unitScale,
      rateAccumulatorRay,
      totalScaledDebt,
      userVaultCollateral: 0n,
      userVaultScaledDebt: 0n,
      userAssetBalance,
      oraclePrice,
      oracleTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      isSupportedAsset: asset.isSupported ?? true,
      isPaused: asset.isPaused ?? false,
    });
  }

  console.log("=== Final VaultInputs ===");
  console.log(`Total vaultInputs created: ${vaultInputs.length}`);
  vaultInputs.forEach((v, idx) => {
    console.log(`${idx + 1}. Asset: ${v.assetAddress}, Collateral: ${v.userVaultCollateral}, Balance: ${v.userAssetBalance}, Supported: ${v.isSupportedAsset}, Paused: ${v.isPaused}`);
  });

  return vaultInputs;
}

export interface Allocation {
  assetAddress: string;
  symbol: string;
  depositAmount: string;
  depositAmountUSD: string;
  mintAmount: string;
  stabilityFeeRate: number;
  existingCollateralUSD: string;
  userBalance: string;
  userBalanceUSD: string;
}

export function getOptimalAllocations(
  targetMintUSD: bigint,
  bufferPercent: number,
  assets: ConversionAssetConfig[],
  vaults: ConversionVaultData[],
  activeTokens: ConversionTokenInfo[],
  prices: ConversionPriceMap,
  globalDebtInfo: ConversionGlobalDebtInfo
): Allocation[] {
  const vaultInputs = convertToVaultInputs(assets, vaults, activeTokens, prices, globalDebtInfo);
  const plan = buildMintPlanWithBuffer(targetMintUSD, bufferPercent, vaultInputs);

  const allocations: Allocation[] = [];
  const assetByAddress = assets.reduce<Record<string, ConversionAssetConfig>>((acc, a) => {
    acc[a.asset.toLowerCase()] = a;
    return acc;
  }, {});

  for (const [assetAddress, summary] of Object.entries(plan.perAssetSummary)) {
    if (summary.plannedMint === 0n && summary.plannedDeposit === 0n) {
      continue;
    }

    const asset = assetByAddress[assetAddress.toLowerCase()];
    if (!asset) continue;

    const vault = vaults.find(v => v.asset.toLowerCase() === assetAddress.toLowerCase());
    const tokenInfo = activeTokens.find(t => t.address?.toLowerCase() === assetAddress.toLowerCase());
    const decimals = vault?.collateralAmountDecimals || tokenInfo?.decimals || 18;

    const depositAmount = summary.plannedDeposit > 0n
      ? formatUnits(summary.plannedDeposit, decimals)
      : "0";
    
    const priceStr = prices[assetAddress.toLowerCase()] || "0";
    const oraclePrice = parseFloat(formatUnits(BigInt(priceStr || "0"), 18));
    const depositAmountUSD = depositAmount !== "0"
      ? (parseFloat(depositAmount) * oraclePrice).toString()
      : "0";

    const mintAmount = summary.plannedMint > 0n
      ? formatUnits(summary.plannedMint, 18)
      : "0";

    const existingCollateralUSD = vault && oraclePrice > 0
      ? (parseFloat(formatUnits(BigInt(vault.collateralAmount || "0"), decimals)) * oraclePrice).toString()
      : "0";

    // Calculate non-collateral balance (total balance minus what's already in vault)
    const totalBalance = tokenInfo && tokenInfo.balance
      ? BigInt(tokenInfo.balance)
      : 0n;
    const vaultCollateral = vault && vault.collateralAmount
      ? BigInt(vault.collateralAmount)
      : 0n;
    const nonCollateralBalance = totalBalance > vaultCollateral
      ? totalBalance - vaultCollateral
      : 0n;
    
    const userBalance = nonCollateralBalance > 0n
      ? formatUnits(nonCollateralBalance, decimals)
      : "0";
    const userBalanceUSD = userBalance !== "0" && oraclePrice > 0
      ? (parseFloat(userBalance) * oraclePrice).toString()
      : "0";

    allocations.push({
      assetAddress,
      symbol: asset.symbol,
      depositAmount,
      depositAmountUSD,
      mintAmount,
      stabilityFeeRate: asset.stabilityFeeRate || 0,
      existingCollateralUSD,
      userBalance,
      userBalanceUSD,
    });
  }

  return allocations.sort((a, b) => {
    const aMint = parseFloat(a.mintAmount);
    const bMint = parseFloat(b.mintAmount);
    return bMint - aMint;
  });
}
