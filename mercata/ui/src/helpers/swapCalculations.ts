import { LiquidityPool } from "@/interface";

/**
 * Calculate swap output amount using AMM formula
 * Based on the same logic as backend getInputPrice function
 */
export const calculateSwapOutput = (
  inputAmount: string,
  pool: LiquidityPool,
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
    ? [BigInt(pool.tokenABalance || "0"), BigInt(pool.tokenBBalance || "0")]
    : [BigInt(pool.tokenBBalance || "0"), BigInt(pool.tokenABalance || "0")];

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
  pool: LiquidityPool,
  isAToB: boolean
): string => {
  if (!outputAmount || outputAmount === "0" || !pool) return "0";

  const outputAmountBigInt = BigInt(outputAmount);
  if (outputAmountBigInt <= 0n) return "0";

  // Get reserves based on swap direction
  const [inputReserve, outputReserve] = isAToB
    ? [BigInt(pool.tokenABalance || "0"), BigInt(pool.tokenBBalance || "0")]
    : [BigInt(pool.tokenBBalance || "0"), BigInt(pool.tokenABalance || "0")];

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
  
  // Add 1 to round up (to ensure user provides enough input)
  const requiredInput = numerator / denominator + 1n;

  // Calculate total input including fee
  // If requiredInput is the net input, we need to calculate the gross input
  // fee = grossInput * feeRate / 10000
  // grossInput = requiredInput + fee
  // grossInput = requiredInput + (grossInput * feeRate / 10000)
  // grossInput * (1 - feeRate/10000) = requiredInput
  // grossInput = requiredInput / (1 - feeRate/10000)
  
  const feeRate = BigInt(pool.swapFeeRate);
  const denominatorForFee = BigInt(10000) - feeRate;
  const grossInput = (requiredInput * BigInt(10000)) / denominatorForFee;

  return grossInput.toString();
};

/**
 * Check if pool has sufficient liquidity for a swap
 */
export const hasSufficientLiquidity = (
  amount: string,
  pool: LiquidityPool,
  isAToB: boolean
): boolean => {
  if (!amount || amount === "0" || !pool) return false;

  const amountBigInt = BigInt(amount);
  const [inputReserve, outputReserve] = isAToB
    ? [BigInt(pool.tokenABalance || "0"), BigInt(pool.tokenBBalance || "0")]
    : [BigInt(pool.tokenBBalance || "0"), BigInt(pool.tokenABalance || "0")];

  return inputReserve > 0n && outputReserve > 0n && amountBigInt <= inputReserve;
};
