import { CollateralData, NewLoanData } from "@/interface";

export const getMaxSafeWithdrawAmount = (
  asset: CollateralData,
  loanData: NewLoanData
): bigint => {
  const ltvBP = BigInt(asset?.ltv ?? "0");
  const priceAssetUSD = BigInt(asset?.assetPrice ?? "0");
  const userCollatAmt = BigInt(asset?.collateralizedAmount ?? "0");
  const tokenDecimals = BigInt(10) ** BigInt(asset?.customDecimals ?? 18);

  if (ltvBP === 0n || priceAssetUSD === 0n) return 0n;

  // Use backend-provided USD capacity to avoid unit mismatches (USD 1e18)
  const availableBorrowingPowerUSD = BigInt(loanData?.maxAvailableToBorrowUSD ?? "0");
  if (availableBorrowingPowerUSD <= 0n) return 0n;

  // amount(tokens) = availableUSD * 10^decimals * 10000 / (priceUSD * ltvBP)
  const withdrawAmtToken = (availableBorrowingPowerUSD * tokenDecimals * 10000n) / (priceAssetUSD * ltvBP);
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

  // Current values from backend (USD 1e18)
  const currentHealthFactorRaw = BigInt(loanData?.healthFactorRaw || 0n);
  const currentCollateralValueUSD = BigInt(loanData?.totalCollateralValueUSD || 0);

  // Derive current borrow value in USD from HF: HF = collateral / debt => debt = collateral / HF
  const currentTotalBorrowValueUSD = currentHealthFactorRaw === 0n
    ? 0n
    : (currentCollateralValueUSD * 10n ** 18n) / currentHealthFactorRaw;

  // If there's no outstanding loan, collateral operations are always healthy
  if (currentTotalBorrowValueUSD === 0n) {
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
    ? currentCollateralValueUSD + amountValueWithThreshold
    : currentCollateralValueUSD - amountValueWithThreshold;

  // Calculate new health factor (raw, scaled to 1e18)
  const newHealthFactorRaw = newCollateralValue <= 0n
    ? 0n
    : (newCollateralValue * 10n ** 18n) / currentTotalBorrowValueUSD;

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

  // Current values from backend (USD 1e18)
  const currentTotalBorrowValueUSD = (() => {
    const hfRaw = BigInt(loanData?.healthFactorRaw || 0n);
    const collUSD = BigInt(loanData?.totalCollateralValueUSD || 0);
    if (hfRaw === 0n) return 0n;
    return (collUSD * 10n ** 18n) / hfRaw;
  })();
  const currentHealthFactorRaw = BigInt(loanData?.healthFactorRaw || 0n);
  const currentCollateralValueUSD = BigInt(loanData?.totalCollateralValueUSD || 0);

  // If there's no outstanding loan, borrow operations have special handling
  if (currentTotalBorrowValueUSD === 0n) {
    if (isBorrow) {
      // For borrow, calculate new health factor for first borrow
      const newHealthFactorRaw = amountWei === 0n
        ? 0n
        : (currentCollateralValueUSD * 10n ** 18n) / amountWei;

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

  // Calculate new borrow value after operation (assumes amountWei in USD 1e18 scale)
  const newBorrowValueUSD = isBorrow
    ? currentTotalBorrowValueUSD + amountWei
    : currentTotalBorrowValueUSD - amountWei;

  // Calculate new health factor (raw, scaled to 1e18)
  const newHealthFactorRaw = newBorrowValueUSD === 0n
    ? 0n
    : (currentCollateralValueUSD * 10n ** 18n) / newBorrowValueUSD;

  // Calculate health impact and isHealthy using raw values
  const healthImpact = newBorrowValueUSD === 0n
    ? Number(10n ** 20n - currentHealthFactorRaw) / 1e18
    : Number(newHealthFactorRaw - currentHealthFactorRaw) / 1e18;
  const isHealthy = newBorrowValueUSD === 0n || newHealthFactorRaw >= 10n ** 18n;

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