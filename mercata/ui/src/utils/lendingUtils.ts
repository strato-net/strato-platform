import { CollateralData, NewLoanData } from "@/interface";

export const getMaxSafeWithdrawAmount = (
  asset: CollateralData,
  loanData: NewLoanData
): bigint => {
  const ltvBP = BigInt(asset?.ltv ?? "0");
  const priceAssetUSD = BigInt(asset?.assetPrice ?? "0");
  const userCollatAmt = BigInt(asset?.collateralizedAmount ?? "0");
  const totalBorrowingPowerUSD = BigInt(loanData?.totalBorrowingPowerUSD ?? "0");
  const totalAmountOwed = BigInt(loanData?.totalAmountOwed ?? "0");
  const tokenDecimals = BigInt(10) ** BigInt(asset?.customDecimals ?? 18);

  if (ltvBP === 0n || priceAssetUSD === 0n) return 0n;

  const availableBorrowingPower = totalBorrowingPowerUSD - totalAmountOwed;
  if (availableBorrowingPower <= 0n) return 0n;

  // amount(tokens) = availableUSD * 10^decimals * 10000 / (priceUSD * ltvBP)
  const withdrawAmtToken = (availableBorrowingPower * tokenDecimals * 10000n) / (priceAssetUSD * ltvBP);
  return withdrawAmtToken < userCollatAmt ? withdrawAmtToken : userCollatAmt;
};

// Calculate health factor color based on value
export const getHealthFactorColor = (healthFactor: number) => {
  if (healthFactor >= 1.5) return "text-green-600";
  if (healthFactor >= 1.2) return "text-yellow-600";
  if (healthFactor >= 1.0) return "text-orange-600";
  return "text-red-600";
};

// Calculate health impact of collateral operations (supply/withdraw) using BigInt and healthFactorRaw
export const calculateCollateralHealthImpact = (
  amountWei: bigint,
  asset: CollateralData,
  loanData: NewLoanData,
  isSupply: boolean = true
) => {
  if (!asset || !loanData) {
    return {
      currentHealthFactor: 0,
      newHealthFactor: 0,
      healthImpact: 0,
      isHealthy: true,
    };
  }

  // Current values from backend
  const currentTotalBorrowValue = BigInt(loanData?.totalAmountOwed || 0);
  const currentHealthFactorRaw = BigInt(loanData?.healthFactorRaw || 0n);
  const currentCollateralValue = BigInt(loanData?.totalCollateralValueUSD || 0);

  // If there's no outstanding loan, collateral operations are always healthy
  if (currentTotalBorrowValue === 0n) {
    return {
      currentHealthFactor: Infinity,
      newHealthFactor: Infinity,
      healthImpact: 0,
      isHealthy: true,
    };
  }

  // Calculate the USD value of the amount (respect token decimals)
  const assetPrice = BigInt(asset?.assetPrice || 0);
  const liquidationThreshold = BigInt(asset?.liquidationThreshold || 0);
  const tokenDecimals = BigInt(10) ** BigInt(asset?.customDecimals ?? 18);

  // Convert token amount (amountWei) to USD 1e18: amount * price / 10^decimals
  const amountValueUSD = (amountWei * assetPrice) / tokenDecimals;

  // Apply liquidation threshold to get health factor value
  const amountValueWithThreshold = (amountValueUSD * liquidationThreshold) / 10000n;

  // Add or subtract from current collateral value based on operation
  const newCollateralValue = isSupply
    ? currentCollateralValue + amountValueWithThreshold
    : currentCollateralValue - amountValueWithThreshold;

  // Calculate new health factor (raw, scaled to 1e18)
  const newHealthFactorRaw =
    currentTotalBorrowValue === 0n
      ? 0n
      : (newCollateralValue * 10n ** 18n) / currentTotalBorrowValue;

  // Calculate health impact and isHealthy using raw values
  const healthImpact = Number(newHealthFactorRaw - currentHealthFactorRaw) / 1e18;
  const isHealthy = newHealthFactorRaw >= 10n ** 18n;

  return {
    currentHealthFactor: Number(currentHealthFactorRaw) / 1e18,
    newHealthFactor: Number(newHealthFactorRaw) / 1e18,
    healthImpact,
    isHealthy,
  };
};

// Calculate health impact of withdrawal using BigInt and healthFactorRaw
export const calculateWithdrawHealthImpact = (
  withdrawAmountWei: bigint,
  asset: CollateralData,
  loanData: NewLoanData
) => {
  return calculateCollateralHealthImpact(withdrawAmountWei, asset, loanData, false);
};

// Calculate health impact of supply using BigInt and healthFactorRaw
export const calculateSupplyHealthImpact = (
  supplyAmountWei: bigint,
  asset: CollateralData,
  loanData: NewLoanData
) => {
  return calculateCollateralHealthImpact(supplyAmountWei, asset, loanData, true);
};

// Calculate health impact of borrow operations (borrow/repay) using BigInt and healthFactorRaw
export const calculateBorrowOperationHealthImpact = (
  amountWei: bigint,
  loanData: NewLoanData,
  isBorrow: boolean = true
) => {
  if (!loanData) {
    return {
      currentHealthFactor: 0,
      newHealthFactor: 0,
      healthImpact: 0,
      isHealthy: true,
    };
  }

  // Current values from backend
  const currentTotalBorrowValue = BigInt(loanData?.totalAmountOwed || 0);
  const currentHealthFactorRaw = BigInt(loanData?.healthFactorRaw || 0n);
  const currentCollateralValue = BigInt(loanData?.totalCollateralValueUSD || 0);

  // If there's no outstanding loan, borrow operations have special handling
  if (currentTotalBorrowValue === 0n) {
    if (isBorrow) {
      // For borrow, calculate new health factor for first borrow
      const newHealthFactorRaw =
        amountWei === 0n
          ? 0n
          : (currentCollateralValue * 10n ** 18n) / amountWei;

      const healthImpact = Number(newHealthFactorRaw) / 1e18;
      const isHealthy = newHealthFactorRaw >= 10n ** 18n;

      return {
        currentHealthFactor: Infinity,
        newHealthFactor: Number(newHealthFactorRaw) / 1e18,
        healthImpact,
        isHealthy,
      };
    } else {
      // For repay with no existing loan, no impact
      return {
        currentHealthFactor: Infinity,
        newHealthFactor: Infinity,
        healthImpact: 0,
        isHealthy: true,
      };
    }
  }

  // Calculate new borrow value after operation
  const newBorrowValue = isBorrow
    ? currentTotalBorrowValue + amountWei
    : currentTotalBorrowValue - amountWei;

  // Calculate new health factor (raw, scaled to 1e18)
  const newHealthFactorRaw =
    newBorrowValue === 0n
      ? 0n
      : (currentCollateralValue * 10n ** 18n) / newBorrowValue;

  // Calculate health impact and isHealthy using raw values
  const healthImpact = newBorrowValue === 0n 
    ? Number(10n ** 20n - currentHealthFactorRaw) / 1e18  // Large positive number when fully repaid
    : Number(newHealthFactorRaw - currentHealthFactorRaw) / 1e18;
  const isHealthy = newBorrowValue === 0n || newHealthFactorRaw >= 10n ** 18n;

  return {
    currentHealthFactor: Number(currentHealthFactorRaw) / 1e18,
    newHealthFactor: Number(newHealthFactorRaw) / 1e18,
    healthImpact,
    isHealthy,
  };
};

// Calculate health impact of repayment using BigInt and healthFactorRaw
export const calculateRepayHealthImpact = (
  repayAmountWei: bigint,
  loanData: NewLoanData
) => {
  return calculateBorrowOperationHealthImpact(repayAmountWei, loanData, false);
};

// Calculate health impact of borrow using BigInt and healthFactorRaw
export const calculateBorrowHealthImpact = (
  borrowAmountWei: bigint,
  loanData: NewLoanData
) => {
  return calculateBorrowOperationHealthImpact(borrowAmountWei, loanData, true);
}; 