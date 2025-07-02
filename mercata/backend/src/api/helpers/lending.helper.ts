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
    principalBalance: loan.principalBalance,        // Original borrowed amount (USD)
    interestOwed: loan.interestOwed,                // Previously accrued interest (USD)
    lastIntCalculated: loan.lastIntCalculated,      // Timestamp of last interest calculation
    lastUpdated: loan.lastUpdated,                  // Timestamp of last loan update
    
    // Calculated values
    newlyAccruedInterest: accruedInterest,          // Interest accrued since last calculation (USD)
    totalAmountOwed: newTotalOwed,                  // Total debt including all interest (USD)
    totalCollateralValueUSD: totalCollateralValue,  // Total collateral value weighted by liquidation thresholds (USD)
    maxBorrowingPowerUSD: maxBorrowingPowerUSD.toString(), // Max borrowing power in USD
    maxAvailableToBorrowUSD: maxAvailableToBorrowUSD.toString(), // Max available to borrow in USD
    healthFactorRatio: healthFactorToPercentage(healthFactor), // Health factor as decimal (1.0 = 100% = liquidation threshold)
    
    // Health status flags
    isAboveLiquidationThreshold: Number(healthFactor) >= Number(DECIMALS), // True if user is safe from liquidation
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