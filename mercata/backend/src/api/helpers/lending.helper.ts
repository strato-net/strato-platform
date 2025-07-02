import { constants } from "../../config/constants";

const toBig = (v: string | number | bigint) => BigInt(v);
const { DECIMALS } = constants;

export interface LoanInfo {
  principalBalance: string;
  interestOwed: string;
  lastIntCalculated: string;
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
 * Simulates the smart contract's _accrueInterest function
 * @param loan The user's loan data
 * @param interestRate Annual interest rate in basis points
 * @param currentTime Current timestamp in seconds
 * @returns accruedInterest and newTotalOwed
 */
export const calculateAccruedInterest = (
  loan: LoanInfo,
  interestRate: number,
  currentTime: number
): { accruedInterest: string; newTotalOwed: string } => {
  if (toBig(loan.principalBalance) === 0n) {
    return { accruedInterest: "0", newTotalOwed: "0" };
  }

  // Calculate time elapsed since last interest calculation
  const timeElapsed = Math.max(0, currentTime - Number(loan.lastIntCalculated));
  const hoursElapsed = BigInt(Math.floor(timeElapsed / 3600)); // Convert to hours

  // Calculate accrued interest: (principal * rate * hours) / (8760 * 10000)
  // 8760 hours per year, 10000 for basis points
  const accruedInterest = (
    (toBig(loan.principalBalance) * BigInt(interestRate) * hoursElapsed) /
    BigInt(8760 * 10000)
  ).toString();

  // Calculate new total owed
  const newTotalOwed = (
    toBig(loan.principalBalance) + 
    toBig(loan.interestOwed) + 
    toBig(accruedInterest)
  ).toString();

  return { accruedInterest, newTotalOwed };
};

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
 * Comprehensive loan simulation that calculates all loan metrics
 * @param loan The user's loan data
 * @param collaterals User's collateral assets and amounts
 * @param assetConfigs Map of asset configurations
 * @param currentTime Current timestamp in seconds
 * @returns Complete loan simulation with all calculated values
 */
export const simulateLoan = (
  loan: LoanInfo,
  collaterals: CollateralInfo[],
  assetConfigs: Map<string, AssetConfig>,
  currentTime: number
) => {
  // Get borrowable asset config (assuming single borrowable asset)
  const borrowableAssetConfig = Array.from(assetConfigs.values())[0];
  if (!borrowableAssetConfig) {
    throw new Error("No borrowable asset configuration found");
  }

  // Calculate interest and total owed
  const { accruedInterest, newTotalOwed } = calculateAccruedInterest(
    loan,
    borrowableAssetConfig.interestRate,
    currentTime
  );

  // Calculate total collateral value for health
  const totalCollateralValue = calculateTotalCollateralValueForHealth(
    collaterals,
    assetConfigs
  );

  // Calculate max borrowing power using existing calculateCollateralMetrics logic
  let maxBorrowingPowerUSD = 0n;
  for (const collateral of collaterals) {
    const config = assetConfigs.get(collateral.asset);
    if (!config) continue;

    const metrics = calculateCollateralMetrics(
      "0", // userBalance not needed for this calculation
      collateral.amount,
      config.price,
      config.ltv || 0
    );
    
    maxBorrowingPowerUSD += toBig(metrics.maxBorrowingPower);
  }

  const maxAvailableToBorrowUSD = maxBorrowingPowerUSD - toBig(newTotalOwed);

  // Calculate health factor using newTotalOwed directly
  const healthFactor = calculateHealthFactor(totalCollateralValue, newTotalOwed);

  return {
    // Original loan data from contract
    principalBalance: loan.principalBalance,
    interestOwed: loan.interestOwed,
    lastIntCalculated: loan.lastIntCalculated,
    lastUpdated: loan.lastUpdated,
    
    // Calculated values
    healthFactor: healthFactorToPercentage(healthFactor),
    totalBorrowingPowerUSD: maxBorrowingPowerUSD.toString(),
    accruedInterest,
    interestRate: borrowableAssetConfig.interestRate / 100,
    totalAmountOwed: newTotalOwed,
    totalCollateralValueUSD: totalCollateralValue,
    maxAvailableToBorrowUSD: maxAvailableToBorrowUSD.toString(),
    
    // Health status flags
    isAboveLiquidationThreshold: Number(healthFactor) >= Number(DECIMALS),
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
 * @param actualUnderlying Total underlying asset in pool
 * @returns Exchange rate scaled by 1e18
 */
export const calculateExchangeRate = (
  totalMTokenSupply: string,
  actualUnderlying: string
): string => {
  const mTokenSupply = toBig(totalMTokenSupply);
  const underlying = toBig(actualUnderlying);
  
  if (mTokenSupply === 0n || underlying === 0n) {
    return DECIMALS.toString(); // Default 1:1 ratio
  }
  
  // Exchange rate = actualUnderlying / totalSupply (scaled by 1e18)
  return ((underlying * DECIMALS) / mTokenSupply).toString();
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
 * Calculate total borrowed amount across all loans
 * @param loans Array of loan entries
 * @param interestRate Interest rate in basis points
 * @param currentTime Current timestamp
 * @returns Total borrowed amount including accrued interest
 */
export const calculateTotalBorrowed = (
  loans: any[],
  interestRate: number,
  currentTime: number
): string => {
  let totalBorrowed = 0n;
  
  for (const loanEntry of loans) {
    const loan = loanEntry.LoanInfo;
    if (loan && loan.principalBalance && toBig(loan.principalBalance) > 0n) {
      const { newTotalOwed } = calculateAccruedInterest(
        {
          principalBalance: loan.principalBalance,
          interestOwed: loan.interestOwed || "0",
          lastIntCalculated: loan.lastIntCalculated || currentTime.toString(),
          lastUpdated: loan.lastUpdated || currentTime.toString(),
        },
        interestRate,
        currentTime
      );
      totalBorrowed += toBig(newTotalOwed);
    }
  }
  
  return totalBorrowed.toString();
};

/**
 * Calculate utilization rate of the pool
 * @param totalBorrowed Total borrowed amount
 * @param totalSupplied Total supplied amount
 * @returns Utilization rate as percentage
 */
export const calculateUtilizationRate = (
  totalBorrowed: string,
  totalSupplied: string
): number => {
  const borrowed = toBig(totalBorrowed);
  const supplied = toBig(totalSupplied);
  
  if (supplied === 0n) return 0;
  
  return Number((borrowed * 10000n) / supplied) / 100;
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
 * Calculate APY values for supply and borrow
 * @param interestRate Interest rate in basis points
 * @param reserveFactor Reserve factor in basis points
 * @returns Object with supplyAPY and borrowAPY
 */
export const calculateAPYs = (
  interestRate: number,
  reserveFactor: number = 1000
): { supplyAPY: number; borrowAPY: number } => {
  const borrowAPY = interestRate / 100; // Convert from basis points
  const supplyAPY = borrowAPY * (1 - reserveFactor / 10000); // Subtract reserve factor
  
  return { supplyAPY, borrowAPY };
}; 