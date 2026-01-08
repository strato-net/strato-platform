import { CollateralData, NewLoanData } from "@/interface";
import { SUPPLY_COLLATERAL_FEE, BORROW_FEE } from "@/lib/constants";

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
  console.log("derived, real:", currentTotalBorrowValueUSD, loanData?.totalAmountOwed);

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


// ----
const centFloor = (value: Number): Number => {
  return Math.floor(+value * 100) / 100;
};

export const centCeil = (value: Number): Number => {
  return Math.ceil(+value * 100) / 100;
};

// Return the maximum amount that can be borrowed with the given health factor
export const calculateAvailableToBorrowUSD = (
  loanData: NewLoanData,
  healthFactor: Number,
  newCollateral: Map<CollateralData, bigint>,
): Number => {
  const targetHFRaw = BigInt(Math.round(Number(healthFactor) * 1e18));
  if (targetHFRaw <= 0n) return 0;

  let totalCollateralValueUSD = BigInt(loanData?.totalCollateralValueUSD ?? "0"); // supplied collat, LT weighted
  
  // Add new collateral value (LT weighted): (amount * price * LT) / (decimals * 10000)
  for (const [collat, amount] of newCollateral.entries()) {
    const price = BigInt(collat.assetPrice ?? "0");
    const lt = BigInt(collat.liquidationThreshold ?? "0");
    const decimals = BigInt(10) ** BigInt(collat.customDecimals ?? 18);
    if (price > 0n && lt > 0n) {
      totalCollateralValueUSD += (amount * price * lt) / (decimals * 10000n);
    }
  }

  const currentDebtUSD = BigInt(loanData?.totalAmountOwed ?? "0");

  // Calculate max debt for target health factor
  const maxDebtForTargetHF = (totalCollateralValueUSD * 10n ** 18n) / targetHFRaw;

  // Available to borrow = maxDebt - currentDebt (clamped to 0)
  // Floor to cents in BigInt space to avoid precision loss
  if (maxDebtForTargetHF <= currentDebtUSD) return 0.00;
  const centsInWei = 10n ** 16n; // 0.01 USD = 1e16 wei
  const availableWei = (maxDebtForTargetHF - currentDebtUSD) / centsInWei * centsInWei;
  const flooredToCentsWei = (availableWei / centsInWei) * centsInWei; // BigInt division truncates (floors)
  return Number(flooredToCentsWei) / 1e18;
};

export const calculateHFSliderExtrema = (
  loanData: NewLoanData,
  collaterals: CollateralData[],
  DEFAULT_MAX_HEALTH_FACTOR: Number = 3.00,
) : { min: Number, max: Number } => {
  const minHF = Math.min(...collaterals.map(c => Number(BigInt(c.liquidationThreshold))/Number(BigInt(c.ltv))));
  
  // Check if there's no loan (no debt)
  const hasLoan = BigInt(loanData?.totalAmountOwed ?? "0") > 1n;
  const currentHF = loanData?.healthFactor ?? 0;
  const isInfiniteHF = !isFinite(currentHF) || currentHF >= 999999;
  
  // If no loan, max is DEFAULT_MAX_HEALTH_FACTOR; otherwise use max of default and current HF
  const maxHF = hasLoan && !isInfiniteHF
    ? Math.max(+DEFAULT_MAX_HEALTH_FACTOR, currentHF)
    : +DEFAULT_MAX_HEALTH_FACTOR;
  
  return { min: centCeil(minHF), max: centFloor(maxHF) };
};

export const determineErrorMessage = (
  borrowAmount: Number,
  maxAtRequestedHF: Number,
  maxAtMinHF: Number
) : string => {
  // Check if borrow amount exceeds maximum at requested health factor
  if (borrowAmount > maxAtRequestedHF) {
    // If even at minimum health factor the max is still too low, don't suggest increasing risk
    if (borrowAmount > maxAtMinHF) {
      return "Borrow amount exceeds the maximum at this health factor.\nConsider bridging in more collateral.";
    }
    
    // Otherwise, suggest increasing risk level as an option
    return "Borrow amount exceeds the maximum at this health factor.\nConsider bridging in more collateral, or increase risk level.";
  }
  
  return "";
};

export const calculateBorrowTxFee = (collateralCount: number): { fee: number, voucher: number } =>
{
    const fee = collateralCount * parseFloat(SUPPLY_COLLATERAL_FEE) + parseFloat(BORROW_FEE);
    const voucher = Math.round(fee * 100);
    return { fee, voucher };
};

export const calculateAdditionalCollateralAmountFromValue = (
  collateralValueUSD: bigint,
  price: bigint,
  decimals: bigint, // i.e. 10n**18n, not 18n
): bigint => {
  if (price === 0n) return 0n;
  return (collateralValueUSD * decimals) / price;
};

/**
 * Calculates the max dollar value that the user can supply of the asset
 * @param balance - user's wei balance of the asset
 * @param price - asset price in USD, such as 21200000000000000000n for $21.20
 * @param decimals - asset decimals, such as 10n**18n for 18 decimals
 * @returns the maxmimum value in USD that the user can supply, such as 3400000000000000000n for $3.40
 * @throws if decimals is 0n
 */
export const calculateMaxCollateralValueFromBalance = (
  balance: bigint,
  price: bigint,
  decimals: bigint, // i.e. 10n**18n, not 18n
): bigint => {
  return (balance * price) / decimals;
};

export const recommendCollateralToSupply = (
  loanData: NewLoanData,
  healthFactor: Number,
  borrowAmountUSD: Number,
  collaterals: CollateralData[],
) : Map<CollateralData, bigint> => {
  sortCollateralAssets(collaterals);
  // TODO this one is AI generated, needs to be verified
  // Should greedily pull from the front of the queue until the health factor is met
  const result = new Map<CollateralData, bigint>();

  // HF = LT_weighted_collateral / debt
  // After borrow: targetHF = (currentLTCollat + newLTCollat) / (currentDebt + borrowAmount)
  // Solve for newLTCollat: newLTCollat = targetHF * (currentDebt + borrowAmount) - currentLTCollat

  const targetHFRaw = BigInt(Math.round(Number(healthFactor) * 1e18));
  const currentLTCollateral = BigInt(loanData?.totalCollateralValueUSD ?? "0");
  const currentDebt = BigInt(loanData?.totalAmountOwed ?? "0");
  const borrowAmount = BigInt(Math.round(Number(borrowAmountUSD) * 1e18));

  const newDebt = currentDebt + borrowAmount;
  if (newDebt === 0n) return result;

  // Required LT-weighted collateral to achieve target HF (add 1 for floored division safety)
  const requiredTotalLTCollateral = (targetHFRaw * newDebt) / (10n ** 18n) + 1n;
  let neededLTValue = requiredTotalLTCollateral > currentLTCollateral
    ? requiredTotalLTCollateral - currentLTCollateral
    : 0n;

  if (neededLTValue === 0n) return result;

  // Greedily iterate through sorted collaterals
  for (const collat of collaterals) {
    if (neededLTValue <= 0n) break;

    const price = BigInt(collat.assetPrice ?? "0");
    const lt = BigInt(collat.liquidationThreshold ?? "0");
    const available = BigInt(collat.userBalance ?? "0"); // unsupplied balance
    const decimals = BigInt(10) ** BigInt(collat.customDecimals ?? 18);

    if (price === 0n || lt === 0n || available === 0n) continue;

    // LT-weighted value of entire available balance: (amount * price * lt) / (decimals * 10000)
    const maxLTValue = (available * price * lt) / (decimals * 10000n);

    if (maxLTValue <= neededLTValue) {
      // Use entire available balance
      result.set(collat, available);
      neededLTValue -= maxLTValue;
    } else {
      // Calculate exact amount needed for remaining LT value (+ 1 wei for floor safety)
      // amount = (neededLTValue * decimals * 10000) / (price * lt) + 1
      const amountNeeded = (neededLTValue * decimals * 10000n) / (price * lt) + 1n;
      result.set(collat, amountNeeded < available ? amountNeeded : available);
      neededLTValue = 0n;
    }
  }

  return result;
};

export const sortCollateralAssets = (
  collaterals: CollateralData[],
  DO_IGNORE_ONE_WEI: boolean = true,
) : void => {
  // - Amongst the collateral asset types the user has already supplied, sort by `asset.balanceOf(user)*lendingPool.config[asset].LTV`
  // - After all of those, sort remaining collateral the user possesses by `asset.balanceOf(user)*lendingPool.config[asset].LTV`
  const nonexistant = DO_IGNORE_ONE_WEI ? 1n : 0n;
  const isSupplied = (collat: CollateralData) => BigInt(collat.collateralizedAmount) > nonexistant;
  collaterals.sort((a, b) => {
    // Supplied collaterals come FIRST
    if (isSupplied(a) && !isSupplied(b)) return -1;
    if (!isSupplied(a) && isSupplied(b)) return 1;
    // Within groups, sort by borrowing power descending (higher first)
    return -Number(BigInt(a.unsuppliedBorrowingPower) - BigInt(b.unsuppliedBorrowingPower));
  });
};

const calculateMinimumLTV = (collaterals: CollateralData[]) : bigint => {
  if (collaterals.length === 0) return 0n;
  return collaterals.map(c => BigInt(c.ltv ?? "0")).reduce((a, b) => a < b ? a : b);
};

export const calculateAdditionalValueNeeded = (
  collaterals: CollateralData[],
  borrowAmount: Number,
  loanData: NewLoanData,
  targetHealthFactor: Number,
) : Number => {
  if (collaterals.length === 0) return 0;
  
  // Find minimum LT (strictest for achieving target HF)
  const minLT = collaterals
    .map(c => BigInt(c.liquidationThreshold ?? "0"))
    .reduce((a, b) => a < b ? a : b);
  if (minLT === 0n) return 0;

  const targetHFRaw = BigInt(Math.round(Number(targetHealthFactor) * 1e18));
  const currentLTCollateral = BigInt(loanData.totalCollateralValueUSD ?? "0");
  const currentDebt = BigInt(loanData.totalAmountOwed ?? "0");
  const newBorrow = BigInt(Math.round(Number(borrowAmount) * 1e18));
  
  const newDebt = currentDebt + newBorrow;
  if (newDebt === 0n) return 0;

  // Required LT-weighted collateral for target HF (+ 1 for floor safety)
  const requiredLTCollateral = (targetHFRaw * newDebt) / (10n ** 18n) + 1n;
  
  if (currentLTCollateral >= requiredLTCollateral) return 0;
  
  const neededLTValue = requiredLTCollateral - currentLTCollateral;
  
  // Convert LT-weighted value to raw value using minLT
  // LT_value = raw_value * LT / 10000, so raw_value = LT_value * 10000 / LT
  const additionalValueNeeded = (neededLTValue * 10000n) / minLT;

  return Number(additionalValueNeeded) / 1e18;
};

export const calculateAfterBorrowHealthFactor = (
  loanData: NewLoanData,
  borrowAmount: Number,
  newCollateralSupplied: Map<CollateralData, bigint>
) : Number => {
  const totalDebtAfterBorrow = BigInt(loanData.totalAmountOwed) + BigInt(Math.round(Number(borrowAmount) * 1e18));
  if (totalDebtAfterBorrow === 0n) return Infinity; // maybe zero can be used for no loan

  // Sum LT-weighted value of new collateral
  let newCollateralLTValue = 0n;
  for (const [collat, amount] of newCollateralSupplied.entries()) {
    const price = BigInt(collat.assetPrice ?? "0");
    const lt = BigInt(collat.liquidationThreshold ?? "0");
    newCollateralLTValue += (amount * price * lt) / (10n**18n * 10000n);
  }

  const totalLTCollateralAfterBorrow = BigInt(loanData.totalCollateralValueUSD ?? "0") + newCollateralLTValue;

  // HF = (LT-weighted collateral * 1e18) / debt
  const newHealthFactorRaw = (totalLTCollateralAfterBorrow * 10n ** 18n) / totalDebtAfterBorrow;

  return Number(newHealthFactorRaw) / 1e18;
};