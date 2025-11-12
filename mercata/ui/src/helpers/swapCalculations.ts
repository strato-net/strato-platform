import { Pool } from "@/interface";

/**
 * Calculate swap output amount using AMM formula
 * Based on the same logic as backend getInputPrice function
 */
export const calculateSwapOutput = (
  inputAmount: string,
  pool: Pool,
  isAToB: boolean
): string => {
  if (!inputAmount || inputAmount === "0" || !pool) return "0";

  const inputAmountBigInt = BigInt(inputAmount);
  if (inputAmountBigInt <= 0n) return "0";

  // Calculate fee
  const fee = (inputAmountBigInt * BigInt(pool.swapFeeRate)) / BigInt(10000);
  const netInput = inputAmountBigInt - fee;

  // Get reserves based on swap direction
  const [inputReserve, outputReserve] = isAToB
    ? [BigInt(pool.tokenA.poolBalance || "0"), BigInt(pool.tokenB.poolBalance || "0")]
    : [BigInt(pool.tokenB.poolBalance || "0"), BigInt(pool.tokenA.poolBalance || "0")];

  // Validate reserves
  if (inputReserve <= 0n || outputReserve <= 0n) {
    throw new Error("Invalid pool reserves");
  }

  // AMM formula: (inputAmount * outputReserve) / (inputReserve + inputAmount)
  const numerator = netInput * outputReserve;
  const denominator = inputReserve + netInput;

  return (numerator / denominator).toString();
};

/**
 * Calculate required input amount for desired output (reverse calculation)
 * Based on the same logic as backend getRequiredInput function
 */
export const calculateSwapInput = (
  outputAmount: string,
  pool: Pool,
  isAToB: boolean
): string => {
  if (!outputAmount || outputAmount === "0" || !pool) return "0";

  const outputAmountBigInt = BigInt(outputAmount);
  if (outputAmountBigInt <= 0n) return "0";

  // Get reserves based on swap direction
  const [inputReserve, outputReserve] = isAToB
    ? [BigInt(pool.tokenA.poolBalance || "0"), BigInt(pool.tokenB.poolBalance || "0")]
    : [BigInt(pool.tokenB.poolBalance || "0"), BigInt(pool.tokenA.poolBalance || "0")];

  // Validate reserves
  if (inputReserve <= 0n || outputReserve <= 0n) {
    throw new Error("Invalid pool reserves");
  }

  if (outputAmountBigInt >= outputReserve) {
    throw new Error("Desired output amount exceeds pool reserves");
  }

  // Reverse AMM formula: (inputReserve * outputAmount) / (outputReserve - outputAmount)
  const numerator = inputReserve * outputAmountBigInt;
  const denominator = outputReserve - outputAmountBigInt;
  
  // Ceil to beat on-chain floor
  // a=11, b=5: ceil(11/5)=3. (11+5-1)/5 = 15/5 = 3.
  const requiredInput = (numerator + denominator - 1n) / denominator;

  // Calculate total input including fee
  // If requiredInput is the net input, we need to calculate the gross input
  // fee = grossInput * feeRate / 10000
  // grossInput = requiredInput + fee
  // grossInput = requiredInput + (grossInput * feeRate / 10000)
  // grossInput * (1 - feeRate/10000) = requiredInput
  // grossInput = requiredInput / (1 - feeRate/10000)
  
  const feeRate = BigInt(pool.swapFeeRate);
  const denominatorForFee = BigInt(10000) - feeRate;
  // Ceil to beat on-chain floor
  const grossInput = (requiredInput * BigInt(10000) + denominatorForFee - 1n) / denominatorForFee;

  return grossInput.toString();
};

/**
 * Check if pool has sufficient liquidity for a swap
 */
export const hasSufficientLiquidity = (
  amount: string,
  pool: Pool,
  isAToB: boolean
): boolean => {
  if (!amount || amount === "0" || !pool) return false;

  const amountBigInt = BigInt(amount);
  const [inputReserve, outputReserve] = isAToB
    ? [BigInt(pool.tokenA.poolBalance || "0"), BigInt(pool.tokenB.poolBalance || "0")]
    : [BigInt(pool.tokenB.poolBalance || "0"), BigInt(pool.tokenA.poolBalance || "0")];

  return inputReserve > 0n && outputReserve > 0n && amountBigInt <= inputReserve;
};

/**
 * Calculate both price impact and pool impact
 * Price impact: I_user = (P_eff - P_before) / P_before
 * Pool impact: I_pool = (1 + I_user)^2 - 1 (constant product AMM relationship)
 * @param currentPoolPrice Current pool exchange rate (as string)
 * @param fromAmount Amount being swapped in (as string, in human-readable format)
 * @param toAmount Amount being received out (as string, in human-readable format)
 * @returns Object with priceImpact and poolImpact as percentages, or null if calculation not possible
 */
export const calculateImpact = (
  currentPoolPrice: string,
  fromAmount: string,
  toAmount: string
): { priceImpact: number; poolImpact: number } | null => {
  if (!currentPoolPrice || !fromAmount || !toAmount || 
      currentPoolPrice === "0" || fromAmount === "0" || toAmount === "0") {
    return null;
  }

  const poolPrice = parseFloat(currentPoolPrice);
  const from = parseFloat(fromAmount);
  const to = parseFloat(toAmount);

  if (isNaN(poolPrice) || isNaN(from) || isNaN(to) || poolPrice === 0 || from === 0) {
    return null;
  }

  const effectivePrice = to / from;
  const priceImpact = Math.abs((effectivePrice - poolPrice) / poolPrice) * 100;
  
  // I_pool = (1 + I_user)^2 - 1
  const priceImpactDecimal = priceImpact / 100;
  const poolImpactDecimal = Math.pow(1 + priceImpactDecimal, 2) - 1;
  const poolImpact = poolImpactDecimal * 100;
  
  return { priceImpact, poolImpact };
};
