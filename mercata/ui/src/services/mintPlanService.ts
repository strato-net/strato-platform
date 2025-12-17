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

const USDST_ADDRESS = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";

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

function computeTargetCRWadFromMultiplier(minCRWad: bigint, multiplier: number): bigint {
  const multiplierWad = BigInt(Math.floor(multiplier * 1000));
  return (minCRWad * multiplierWad) / 1000n;
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
  const multiplier = riskBand === RiskBand.LOW ? 1.0 : riskBand === RiskBand.MEDIUM ? 1.2 : 1.4;
  return buildMintPlanWithBuffer(targetMintUSD, multiplier, vaultInputs);
}

export function buildMintPlanWithBuffer(
  targetMintUSD: bigint,
  multiplier: number,
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
  vaultInputs.forEach((v, idx) => {
    console.log(`  Input ${idx + 1}: ${v.assetAddress}, collateral=${v.userVaultCollateral}, balance=${v.userAssetBalance}, supported=${v.isSupportedAsset}, paused=${v.isPaused}, price=${v.oraclePrice}, unitScale=${v.unitScale}`);
  });
  
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
      console.log(`Filtered out ${v.assetAddress}: no collateral or balance (collateral=${v.userVaultCollateral}, balance=${v.userAssetBalance})`);
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
    const targetCR = computeTargetCRWadFromMultiplier(v.minCRWad, multiplier);
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

  // Sort by stability fee rate (lowest first) for greedy allocation
  // Use annual percentage for more reliable sorting (RAY values are too close)
  workingVaults.sort((a, b) => {
    if (a.stabilityFeeRateAnnual < b.stabilityFeeRateAnnual) return -1;
    if (a.stabilityFeeRateAnnual > b.stabilityFeeRateAnnual) return 1;
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

  // Greedy algorithm: fill cheapest vaults first until they hit limits
  for (const w of workingVaults) {
    if (remainingMintUSD <= 0n) {
      break;
    }

    let vaultCollateral = w.currentVaultCollateral;
    let vaultDebtUSD = w.currentVaultDebtUSD;
    let assetBalance = w.currentAssetBalance;
    let globalDebtUSD = w.currentGlobalDebtUSD;

    const price = w.oraclePrice;
    const targetCR = w.targetCRWad;
    const debtFloor = w.debtFloorUSD;
    const debtCeiling = w.debtCeilingUSD;
    const unitScale = w.unitScale;

    if (assetBalance <= 0n && vaultCollateral <= 0n) {
      continue;
    }
    if (price <= 0n) {
      continue;
    }

    // Calculate max mint capacity for this vault
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

    let maxExtraMintUSD = headroomFromCollateral < headroomFromCeiling
      ? headroomFromCollateral
      : headroomFromCeiling;

    if (maxExtraMintUSD <= 0n) {
      continue;
    }

    // Respect debt floor
    const hasExistingDebt = vaultDebtUSD > 0n;
    if (!hasExistingDebt && debtFloor > 0n) {
      if (maxExtraMintUSD < debtFloor) {
        if (remainingMintUSD >= debtFloor) {
          maxExtraMintUSD = debtFloor;
        } else {
          continue;
        }
      }
    }

    // Greedy: mint as much as possible from this vault (up to its max or remaining amount)
    let plannedMintHereUSD =
      maxExtraMintUSD < remainingMintUSD
        ? maxExtraMintUSD
        : remainingMintUSD;

    if (plannedMintHereUSD <= 0n) {
      continue;
    }

    // Calculate required collateral for this mint amount
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

    // If we don't have enough balance, clamp mint to what's possible
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

      // Clamp to effective headroom and remaining amount
      plannedMintHereUSD =
        effectiveHeadroomUSD < remainingMintUSD
          ? effectiveHeadroomUSD
          : remainingMintUSD;

      if (plannedMintHereUSD <= 0n) {
        continue;
      }

      // Recalculate required collateral with clamped amount
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

    // Add deposit transaction if needed
    if (extraCollateralNeeded > 0n) {
      transactions.push({
        type: "DEPOSIT",
        assetAddress: w.assetAddress,
        amountCollateral: extraCollateralNeeded,
      });
      perAssetSummary[w.assetAddress].plannedDeposit += extraCollateralNeeded;
    }

    // Add mint transaction
    transactions.push({
      type: "MINT",
      assetAddress: w.assetAddress,
      amountUSD: plannedMintHereUSD,
    });
    perAssetSummary[w.assetAddress].plannedMint += plannedMintHereUSD;

    // Update state for next iteration
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

  console.log("=== User Balances of Supported Assets ===");
  const supportedAssetsWithBalance: Array<{ asset: ConversionAssetConfig; tokenInfo: ConversionTokenInfo; balance: bigint }> = [];
  for (const asset of assets) {
    if (isDummyAddress(asset.asset)) {
      continue;
    }
    if (!supportedUnpausedAssets.has(asset.asset.toLowerCase())) {
      continue;
    }
    const tokenInfo = tokensByAddress[asset.asset.toLowerCase()];
    if (tokenInfo) {
      const balance = BigInt(tokenInfo.balance || "0");
      if (balance > 0n) {
        supportedAssetsWithBalance.push({ asset, tokenInfo, balance });
      }
    }
  }
  console.log(`Total supported assets with balance: ${supportedAssetsWithBalance.length}`);
  supportedAssetsWithBalance.forEach((item, idx) => {
    const decimals = item.tokenInfo.decimals || 18;
    const balanceFormatted = formatUnits(item.balance, decimals);
    console.log(`${idx + 1}. ${item.asset.symbol || 'N/A'} (${item.asset.asset}): ${balanceFormatted} tokens, Balance: ${item.balance.toString()}`);
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
  multiplier: number,
  assets: ConversionAssetConfig[],
  vaults: ConversionVaultData[],
  activeTokens: ConversionTokenInfo[],
  prices: ConversionPriceMap,
  globalDebtInfo: ConversionGlobalDebtInfo
): Allocation[] {
  const vaultInputs = convertToVaultInputs(assets, vaults, activeTokens, prices, globalDebtInfo);
  const plan = buildMintPlanWithBuffer(targetMintUSD, multiplier, vaultInputs);

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
