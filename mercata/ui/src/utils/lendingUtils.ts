import { CollateralData, NewLoanData } from "@/interface";
import { SUPPLY_COLLATERAL_FEE, BORROW_FEE } from "@/lib/constants";
import { safeParseUnits } from "@/utils/numberUtils";

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

// Below: Utilities for New Borrow UX with Risk Slider and Automatic Collateral Supply

// Floor the value to the nearest 0.01;
// e.g. 3.409 -> 3.40, 3.45 --> 3.45
// @dev could be unreliable with javascript's floating point precision
export const centFloor = (value: Number): Number => {
  return Math.floor(+value * 100) / 100;
};

// Ceil the value to the nearest 0.01;
// e.g. 3.401 -> 3.41, 3.45 --> 3.45
// @dev could be unreliable with javascript's floating point precision
export const centCeil = (value: Number): Number => {
  return Math.ceil(+value * 100) / 100;
};

// Ceiling division, helpful when reversing calculations that use floored division
// @dev b must be > 0n
const ceilDivBigInt = (a: bigint, b: bigint): bigint => {
  if (b <= 0n) return 0n; // ERROR!
  return (a + b - 1n) / b;
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
  const flooredToCentsWei = (availableWei / centsInWei) * centsInWei; // using BigInt floored division
  return Number(flooredToCentsWei) / 1e18;
};

/**
 * Determine the left-hand low-risk (max) and right-hand high-risk (min) health factors for the slider.
 * @param loanData - The current loan data fetched from the backend
 * @param collaterals - The current collateral data fetched from the backend
 * @param DEFAULT_MAX_HEALTH_FACTOR - The default maximum health factor, overriden if the current health factor is higher. 3.00 by default.
 * @param DEFAULT_MIN_HEALTH_FACTOR - The default minimum health factor, used only when data is unavailable. 1.07 by default.
 * @param BASICALLY_INFINITE_HEALTH - The value above which the health factor is considered infinite. 999999 by default.
 * @returns The minimum and maximum health factors for the slider
 */
export const calculateHFSliderExtrema = (
  loanData: NewLoanData,
  collaterals: CollateralData[],
  DEFAULT_MAX_HEALTH_FACTOR: number = 3.00,
  DEFAULT_MIN_HEALTH_FACTOR: number = 1.07,
  BASICALLY_INFINITE_HEALTH: number = 999999,
) : { min: Number, max: Number } => {
  // If no data is available, use the defaults
  if (!loanData || !collaterals || collaterals.length === 0) {
    return { min: DEFAULT_MIN_HEALTH_FACTOR, max: DEFAULT_MAX_HEALTH_FACTOR };
  }

  // The slider should only go down to the least risky asset's minimum health factor
  const minHF = Math.max(...collaterals.map(c => Number(BigInt(c.liquidationThreshold))/Number(BigInt(c.ltv))));
  
  // Check if there's no loan (no debt)
  const hasLoan = BigInt(loanData?.totalAmountOwed ?? "0") > 1n;
  const currentHF = loanData?.healthFactor ?? 0;
  const isInfiniteHF = !isFinite(currentHF) || currentHF >= BASICALLY_INFINITE_HEALTH;
  
  // If no loan, max is DEFAULT_MAX_HEALTH_FACTOR; otherwise use max of default and current HF
  const maxHF = hasLoan && !isInfiniteHF
    ? Math.max(DEFAULT_MAX_HEALTH_FACTOR, currentHF)
    : DEFAULT_MAX_HEALTH_FACTOR;
  
  return { min: centCeil(minHF), max: centFloor(maxHF) };
};

// Determine the error message to display, suggesting options for the user while avoiding unavailable solutions.
// Returns a string including newlines for line breaks; should by formatted by a UI component that parses this. (whitespace-pre-line)
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

/**
 * Calculate the total fees for all of the transactions that will be triggered by this borrow.
 * @param collateralCount The number of distinct additional collateral assets being supplied.
 * @returns The fee in USDST numeric (i.e. 0.03) and voucher integer (i.e. 3)
 */
export const calculateBorrowTxFee = (collateralCount: number): { fee: number, voucher: number } =>
{
    const fee = collateralCount * parseFloat(SUPPLY_COLLATERAL_FEE) + parseFloat(BORROW_FEE);
    const voucher = Math.round(fee * 100);
    return { fee, voucher };
};

/**
 * Calculate the wei amount of collateral asset whose total value in USD is the provided dollar value
 * @param collateralValueUSD The user-supplied dollar value from which to calculate the asset amount
 * @param price The oracle price of the collateral asset in wei. If price is <= 0n, returns 0n.
 * @param decimals The number of decimals of the collateral asset, defaulting to 18
 * @returns The amount of collateral asset to supply in wei
 */
export const calculateAdditionalCollateralAmountFromValue = (
  collateralValueUSD: string,
  price: bigint,
  decimals: number = 18,
): bigint => {
  const collateralValueWei = safeParseUnits(collateralValueUSD || "0", 18);
  if (price <= 0n) return 0n;
  return ceilDivBigInt(collateralValueWei * 10n ** BigInt(decimals), price);
};

/**
 * Calculates the max dollar value that the user can supply of the asset, floored to cents
 * @param collateral - the collateral asset to evaluate
 * @returns the maximum value in USD floored to cents, such as 3.40 for $3.409
 */
export const calculateMaxCollateralValueUSDCentFloored = (collateral: CollateralData): number => {
  const balance = BigInt(collateral.userBalance ?? "0");
  const price = BigInt(collateral.assetPrice ?? "0");
  const decimals = BigInt(10) ** BigInt(collateral.customDecimals ?? 18);
  const maxValueWei = (balance * price) / decimals
  const maxValueUSD = Number(maxValueWei) / 1e18;
  return Math.floor(maxValueUSD * 100) / 100; // Floor to cents
};

/**
 * Recommends the additional collateral assets to supply to achieve the target health factor.
 * Sorts the collateral assets according to the sort algorithm specified in the sortCollateralAssets docstring,
 * and then pulls from the front of the queue until the health factor is met.
 * This minimizes the number of distinct collateral assets needing to be supplied.
 * @param loanData The current loan data fetched from the backend
 * @param healthFactor The target health factor the user is trying to achieve
 * @param borrowAmountUSD The amount of USDST the user is trying to borrow
 * @param collaterals mutated; A copy of the current collateral data fetched from the backend. Will be sorted in place.
 * @returns The recommended additional collateral assets, mapped to the recommended wei amount to supply
 */
export const recommendCollateralToSupply = (
  loanData: NewLoanData,
  healthFactor: Number,
  borrowAmountUSD: Number,
  collaterals: CollateralData[],
) : Map<CollateralData, bigint> => {
  const result = new Map<CollateralData, bigint>();

  // First, sort the collateral assets
  sortCollateralAssets(collaterals);
  
  const targetHFRaw = BigInt(Math.round(Number(healthFactor) * 1e18));
  const currentLTCollateral = BigInt(loanData?.totalCollateralValueUSD ?? "0");
  const currentDebt = BigInt(loanData?.totalAmountOwed ?? "0");
  const borrowAmount = BigInt(Math.round(Number(borrowAmountUSD) * 1e18));

  const newDebt = currentDebt + borrowAmount;

  // Required LT-weighted collateral to achieve target HF
  const requiredTotalLTCollateral = ceilDivBigInt(targetHFRaw * newDebt, 10n ** 18n);
  let neededLTValue = requiredTotalLTCollateral > currentLTCollateral
    ? requiredTotalLTCollateral - currentLTCollateral
    : 0n;

  // We might not need to supply any additional collateral
  if (neededLTValue === 0n) return result;

  // Greedily pull from front of sorted collaterals until the health factor is met
  for (const collat of collaterals) {
    if (neededLTValue <= 0n) break;

    const available = BigInt(collat.userBalance ?? "0"); // unsupplied balance
    // LT-weighted value of entire available balance: (amount * price * lt) / (decimals * 10000)
    const maxLTValue = BigInt(collat.unsuppliedLTCollateralValue ?? "0");

    if (available === 0n || maxLTValue === 0n) continue;

    if (maxLTValue <= neededLTValue) {
      // Use entire available balance
      result.set(collat, available);
      neededLTValue -= maxLTValue;
    } else {
      // Calculate exact amount needed for remaining LT value
      const price = BigInt(collat.assetPrice ?? "0");
      const lt = BigInt(collat.liquidationThreshold ?? "0");
      const decimals = BigInt(10) ** BigInt(collat.customDecimals ?? 18);
      
      if (price === 0n || lt === 0n) continue;
      const amountNeeded = ceilDivBigInt(neededLTValue * decimals * 10000n, price * lt);
      result.set(collat, amountNeeded < available ? amountNeeded : available);
      neededLTValue = 0n;
    }
  }

  return result;
};

/**
 * Sort collateral assets in place by unsupplied borrowing power, most to least, with all supplied assets coming first.
 * - Amongst the collateral asset types the user has already supplied, sort by `asset.balanceOf(user)*lendingPool.config[asset].LTV`
 * - After all of those, sort remaining collateral the user possesses by `asset.balanceOf(user)*lendingPool.config[asset].LTV`
 * @param collaterals The array of collateral assets to sort in place.
 * @param DO_IGNORE_ONE_WEI Whether to consider one wei of an asset supplied to be a non-supplied asset (default true)
 */
export const sortCollateralAssets = (
  collaterals: CollateralData[],
  DO_IGNORE_ONE_WEI: boolean = true,
) : void => {
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

// Get the minimum LTV from the array of collateral assets
// Returns the minimum LTV in basis points bigint, e.g. 7500n for 75%
const calculateMinimumLTV = (collaterals: readonly CollateralData[]) : bigint => {
  return collaterals.map(c => BigInt(c.ltv ?? "0")).reduce(((a, b) => a < b ? a : b), 0n);
};

/**
 * Calculates the total USD value of additional collateral which would need
 * to be supplied to achieve the target health factor after the specified borrow
 * @param collaterals The current collateral data fetched from the backend
 * @param borrowAmount The amount of USDST the user is trying to borrow
 * @param loanData The current loan data fetched from the backend
 * @param targetHealthFactor The target health factor the user is trying to achieve
 * @returns The total USD value of additional collateral needed
 */
export const calculateAdditionalValueNeeded = (
  collaterals: CollateralData[],
  borrowAmount: Number,
  loanData: NewLoanData,
  targetHealthFactor: Number,
) : Number => {
  if (!loanData || !collaterals || collaterals.length === 0) return 0;
  
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

  // Required LT-weighted collateral for target HF
  const requiredLTCollateral = ceilDivBigInt(targetHFRaw * newDebt, 10n ** 18n);
  
  if (currentLTCollateral >= requiredLTCollateral) return 0;
  
  const neededLTValue = requiredLTCollateral - currentLTCollateral;
  
  // Convert LT-weighted value to raw value using minLT
  // LT_value = raw_value * LT / 10000, so raw_value = LT_value * 10000 / LT
  const additionalValueNeeded = (neededLTValue * 10000n) / minLT;

  return Number(additionalValueNeeded) / 1e18;
};

/**
 * Calculates the actual health factor which would be reached after borrowing the specified amount
 * with the specified additional collateral supplies.
 * May be healthier than the health factor selected using the slider, if the user is already
 * in such a good position that borrowing the specified amount with no additional collateral
 * already achieves a superior health factor.
 * @param loanData The current loan data fetched from the backend
 * @param borrowAmount The amount of USDST the user is trying to borrow; should be > 0
 * @param newCollateralSupplied The additional collateral assets, mapped to the wei amount being supplied
 * @returns The predicted health factor after all the supply and borrow transactions are completed
 */
export const calculateAfterBorrowHealthFactor = (
  loanData: NewLoanData,
  borrowAmount: Number,
  newCollateralSupplied: Map<CollateralData, bigint>
) : Number => {
  const totalDebtAfterBorrow = BigInt(loanData.totalAmountOwed) + BigInt(Math.round(Number(borrowAmount) * 1e18));
  if (totalDebtAfterBorrow === 0n) return 0; // should not occur

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

// @dev TODO: the same is implemented in loanUtils.ts;
// need to consolidate after both PRs are merged
export const getRiskLabel = (factor: number): string => {
  if (factor >= 2.0) return 'Low Risk';
  if (factor >= 1.5) return 'Moderate Risk';
  return 'High Risk';
};