import { constants } from "../../config/constants";

export const toBig = (v: string | number | bigint | null | undefined) => {
  try {
    return v == null || v === "" ? 0n : BigInt(v);
  } catch {
    return 0n; // fallback if input is invalid
  }
};

const { DECIMALS } = constants;

export const RAY = 10n ** 27n;
const YEAR = 31536000n;

export const debtFromScaled = (scaledDebt: string, borrowIndex: string): string => {
  const sd = BigInt(scaledDebt || "0");
  const idx = BigInt(borrowIndex || "0");
  return ((sd * idx) / RAY).toString();
};

export const totalDebtFromScaled = (totalScaledDebt: string, borrowIndex: string): string => {
  const tsd = BigInt(totalScaledDebt || "0");
  const idx = BigInt(borrowIndex || "0");
  return ((tsd * idx) / RAY).toString();
};

export const previewBorrowIndexFromFlatApr = (
  borrowIndex: string,      // RAY as string
  aprBps: string | number,  // basis points
  lastAccrual: string,      // seconds (string)
  nowTsSec: number          // seconds (number)
): string => {
  const idx = BigInt(borrowIndex || "0");
  const dt = BigInt(nowTsSec) - BigInt(lastAccrual || "0");
  if (dt <= 0n) return idx.toString();
  const factorRAY = (BigInt(aprBps) * RAY * dt) / (10000n * YEAR);
  return ((idx * (RAY + factorRAY)) / RAY).toString();
};

export const exchangeRateFromComponents = (
  cash: string,            // ERC20(borrowable).balanceOf(LiquidityPool)
  totalDebt: string,       // system debt in underlying
  reservesAccrued: string, // protocol reserves
  mTokenSupply: string
): string => {
  const cashN = BigInt(cash || "0");
  const debtN = BigInt(totalDebt || "0");
  const resN  = BigInt(reservesAccrued || "0");
  const supN  = BigInt(mTokenSupply || "0");
  if (supN === 0n) return (10n ** 18n).toString();
  let underlying = cashN + debtN;
  underlying = resN < underlying ? (underlying - resN) : cashN; // floor at cash
  if (underlying === 0n) return (10n ** 18n).toString();
  return ((underlying * (10n ** 18n)) / supN).toString();
};

export interface LoanInfo {
  scaledDebt: string;
  lastUpdated: string;
}

export interface AssetConfig {
  interestRate: number;
  liquidationThreshold: number;
  price: string;
  ltv?: number;
}

export interface CollateralInfo {
  asset: string;
  amount: string;
}


/**
 * Simulates the smart contract's _getTotalCollateralValueForHealth function
 * @param collaterals Array of user's collateral assets and amounts
 * @param assetConfigs Map of asset configurations (price, liquidation threshold)
 * @returns Total collateral value for health factor calculation
 */
export const calculateTotalCollateralValueForHealth = (
  collaterals: CollateralInfo[],
  assetConfigs: Map<string, AssetConfig>
): string => {
  let totalValue = 0n;

  for (const collateral of collaterals) {
    const config = assetConfigs.get(collateral.asset);
    if (!config) continue;

    const collateralAmount = toBig(collateral.amount);
    if (collateralAmount === 0n) continue;

    const price = toBig(config.price);
    const liqThreshold = BigInt(config.liquidationThreshold);
    
    if (price === 0n || liqThreshold === 0n) continue;

    // Calculate: (collateralAmount * price * liqThreshold) / (1e18 * 10000)
    totalValue += (collateralAmount * price * liqThreshold) / (DECIMALS * 10000n);
  }

  return totalValue.toString();
};

/**
 * Simulates the smart contract's getHealthFactor function
 * @param totalCollateralValue Total collateral value for health calculation
 * @param totalBorrowValue Total borrow value in USD
 * @returns Health factor scaled by 1e18 (1.0e18 = 100% = liquidation threshold)
 */
export const calculateHealthFactor = (
  totalCollateralValue: string,
  totalBorrowValue: string
): string => {
  const collateralValue = toBig(totalCollateralValue);
  const borrowValue = toBig(totalBorrowValue);

  if (borrowValue === 0n) return (2n ** 256n - 1n).toString(); // No debt = infinite health
  if (collateralValue === 0n) return "0"; // No collateral = 0 health

  // Aave style: health factor = (collateral * liquidation_threshold) / debt
  return ((collateralValue * DECIMALS) / borrowValue).toString();
};

/**
 * Simulate a user's loan using index-based debt and collateral values.
 *
 * @param loan          User's loan snapshot (scaledDebt, lastUpdated)
 * @param collaterals   User's collateral assets and amounts
 * @param assetConfigs  Map of asset -> { price (1e18 USD), liquidationThreshold (bps), ltv (bps), interestRate (bps) }
 * @param borrowIndex   Global borrow index (RAY, 1e27) as string
 */
export const simulateLoan = (
  loan: LoanInfo | null,
  collaterals: CollateralInfo[],
  assetConfigs: Map<string, AssetConfig>,
  borrowIndex: string
) => {
  // 1) Borrowable asset config (single borrowable asset model)
  const borrowableAssetConfig = Array.from(assetConfigs.values())[0];
  if (!borrowableAssetConfig) {
    throw new Error("No borrowable asset configuration found");
  }

  // 2) Default loan if none exists
  const actualLoan: LoanInfo = loan || {
    scaledDebt: "0",
    lastUpdated: "0",
  };

  // 3) Current debt (underlying units) using the borrow index
  const totalAmountOwed = debtFromScaled(actualLoan.scaledDebt, borrowIndex); // underlying (18d)

  // 4) Convert debt to USD (18 decimals)
  const priceUSD = toBig(borrowableAssetConfig.price); // 1e18
  const totalBorrowValueUSD = (toBig(totalAmountOwed) * priceUSD) / DECIMALS;

  // 5) Total collateral value for health (USD, 18 decimals)
  const totalCollateralValueUSD = calculateTotalCollateralValueForHealth(
    collaterals,
    assetConfigs
  );

  // 6) Max borrowing power (sum across collaterals by LTV)
  let maxBorrowingPowerUSD = 0n;
  for (const collateral of collaterals) {
    const cfg = assetConfigs.get(collateral.asset);
    if (!cfg) continue;

    const metrics = calculateCollateralMetrics(
      "0", // user token balance not needed here
      collateral.amount,
      cfg.price,                  // USD 1e18
      cfg.ltv || 0                // bps
    );
    maxBorrowingPowerUSD += toBig(metrics.maxBorrowingPower);
  }

  const maxAvailableToBorrowUSD = maxBorrowingPowerUSD > totalBorrowValueUSD
    ? (maxBorrowingPowerUSD - totalBorrowValueUSD)
    : 0n;

  // 7) Health factor uses USD values (18 decimals)
  const healthFactorRaw = calculateHealthFactor(
    totalCollateralValueUSD,
    totalBorrowValueUSD.toString()
  );

  return {
    // Core loan state
    scaledDebt: actualLoan.scaledDebt,
    lastUpdated: actualLoan.lastUpdated,

    // Index-based results
    totalAmountOwed,                        // underlying (18d)

    // Health and capacity (USD 18d)
    healthFactor: Number(toBig(healthFactorRaw)) / Number(DECIMALS),
    healthFactorRaw,
    totalBorrowingPowerUSD: maxBorrowingPowerUSD.toString(),
    totalCollateralValueUSD: totalCollateralValueUSD,
    maxAvailableToBorrowUSD: maxAvailableToBorrowUSD.toString(),

    // Display APR (bps → percent) if needed by callers
    interestRate: borrowableAssetConfig.interestRate,
    isAboveLiquidationThreshold: Number(toBig(healthFactorRaw)) >= Number(DECIMALS),
  };
};

/**
 * Convert health factor from contract format (1e18 = 100%) to percentage
 * @param healthFactor Health factor from contract (scaled by 1e18)
 * @returns Health factor as percentage (1.0 = 100%)
 */
export const healthFactorToPercentage = (healthFactor: string): number => {
  return Number(toBig(healthFactor)) / Number(DECIMALS);
};

/**
 * Convert percentage to health factor format (1.0 = 100% becomes 1e18)
 * @param percentage Health factor as percentage (1.0 = 100%)
 * @returns Health factor in contract format (scaled by 1e18)
 */
export const percentageToHealthFactor = (percentage: number): string => {
  return (BigInt(Math.round(percentage * Number(DECIMALS)))).toString();
};

/**
 * Calculate user balance value, collateralized amount value, and max borrowing power
 * @param userBalance User's token balance
 * @param collateralizedAmount Amount of tokens used as collateral
 * @param assetPrice Price of the asset in USD (18 decimals)
 * @param ltv Loan-to-Value ratio in basis points (e.g., 7500 = 75%)
 * @returns Object with calculated values
 */
export const calculateCollateralMetrics = (
  userBalance: string,
  collateralizedAmount: string,
  assetPrice: string,
  ltv: number
): {
  userBalanceValue: string;
  collateralizedAmountValue: string;
  maxBorrowingPower: string;
} => {
  const balance = toBig(userBalance);
  const collateralized = toBig(collateralizedAmount);
  const price = toBig(assetPrice);
  const ltvBasisPoints = BigInt(ltv);

  // Calculate values in USD (18 decimals)
  const userBalanceValue = ((balance * price) / DECIMALS).toString();
  const collateralizedAmountValue = ((collateralized * price) / DECIMALS).toString();
  
  // Calculate max borrowing power using LTV: (collateralizedAmount * price * ltv) / (1e18 * 10000)
  const maxBorrowingPower = ((collateralized * price * ltvBasisPoints) / (DECIMALS * 10000n)).toString();

  return {
    userBalanceValue,
    collateralizedAmountValue,
    maxBorrowingPower,
  };
};

/**
 * Calculate exchange rate between mToken and underlying asset
 * @param totalMTokenSupply Total mToken supply
 * @param totalUSDSTSupplied Total underlying asset in pool
 * @returns Exchange rate scaled by 1e18
 */
export const calculateExchangeRate = (
  cash: string,            // ERC20(borrowable).balanceOf(LiquidityPool)
  totalDebt: string,       // system debt in underlying
  reservesAccrued: string, // protocol reserves in underlying
  mTokenSupply: string     // total mToken supply
): string => {
  const cashN = BigInt(cash || "0");
  const debtN = BigInt(totalDebt || "0");
  const resN  = BigInt(reservesAccrued || "0");
  const supN  = BigInt(mTokenSupply || "0");
  if (supN === 0n) return (10n ** 18n).toString();

  let underlying = cashN + debtN;
  underlying = resN < underlying ? (underlying - resN) : cashN; // floor at cash
  if (underlying === 0n) return (10n ** 18n).toString();

  return ((underlying * (10n ** 18n)) / supN).toString();
};

/**
 * Calculate total USDST supplied based on mToken supply and exchange rate
 * @param totalMTokenSupply Total mToken supply
 * @param exchangeRate Exchange rate scaled by 1e18
 * @returns Total USDST supplied
 */
export const calculateTotalUSDSTSupplied = (
  totalMTokenSupply: string,
  exchangeRate: string
): string => {
  const mTokenSupply = toBig(totalMTokenSupply);
  const rate = toBig(exchangeRate);
  
  return ((mTokenSupply * rate) / DECIMALS).toString();
};

/**
 * Calculate utilization rate of the pool
 * @param totalBorrowed Total borrowed amount
 * @param totalSupplied Total supplied amount
 * @returns Utilization rate as percentage
 */
export const calculateUtilizationRate = (
  cash: string,
  totalDebt: string,
  reservesAccrued: string
): number => {
  const cashN = BigInt(cash || "0");
  const debtN = BigInt(totalDebt || "0");
  const resN  = BigInt(reservesAccrued || "0");
  let denom = cashN + debtN;
  denom = resN < denom ? (denom - resN) : cashN;
  if (denom === 0n) return 0;
  return Number((debtN * 10000n) / denom) / 100; // percent with 2 decimals
};

/**
 * Calculate total collateral value across all users
 * @param assetConfigs Array of asset configurations
 * @param allCollaterals Array of all user collaterals
 * @param prices Map of asset prices
 * @param borrowableAsset Address of borrowable asset to exclude
 * @returns Total collateral value in USD
 */
export const calculateTotalCollateralValue = (
  assetConfigs: any[],
  allCollaterals: any[],
  prices: Map<string, string>,
  borrowableAsset: string
): string => {
  let totalValue = 0n;
  
  for (const config of assetConfigs) {
    if (config.asset === borrowableAsset) continue;
    
    const price = prices.get(config.asset) || "0";
    if (price === "0" || !config.AssetConfig?.liquidationThreshold) continue;
    
    // Sum all collateral for this asset across all users
    let totalAssetCollateral = 0n;
    for (const collateral of allCollaterals) {
      if (collateral.asset === config.asset) {
        totalAssetCollateral += toBig(collateral.amount);
      }
    }
    
    if (totalAssetCollateral > 0n) {
      const collateralValue = (
        totalAssetCollateral * 
        toBig(price) * 
        BigInt(config.AssetConfig.liquidationThreshold)
      ) / (DECIMALS * 10000n);
      totalValue += collateralValue;
    }
  }
  
  return totalValue.toString();
};

/**
 * Calculate theoretical APY for supply and APY for borrow
 * @param interestRate Interest rate in basis points
 * @param reserveFactor Reserve factor in basis points
 * @returns Object with supplyAPY and borrowAPY
 */
export const calculateAPYs = (
  interestRate: number,
  reserveFactor: number = 1000
): { supplyAPY: number; borrowAPY: number } => {
  // interestRate is in bps, so /100 gives percent
  const borrowAPY = interestRate / 100;
  // reserveFactor is in bps, so /10000 is fraction
  const supplyAPY = borrowAPY * (1 - reserveFactor / 10000);
  return { supplyAPY, borrowAPY };
};