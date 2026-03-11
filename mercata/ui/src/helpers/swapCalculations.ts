import { Pool, PoolCoin } from "@/interface";

/**
 * Check if a pool is a multi-token pool (more than 2 coins)
 */
export const isMultiTokenPool = (pool: Pool): boolean => {
  return !!(pool.coins && pool.coins.length > 2);
};

/**
 * Get the oracle-based exchange rate between two tokens in a multi-token pool.
 * Returns the rate as a string (how much tokenOut you get per 1 tokenIn).
 */
export const getMultiTokenExchangeRate = (
  pool: Pool,
  fromAddress: string,
  toAddress: string
): string => {
  if (!pool.coins) return "0";
  const fromCoin = pool.coins.find(c => c.address === fromAddress);
  const toCoin = pool.coins.find(c => c.address === toAddress);
  if (!fromCoin || !toCoin) return "0";

  const fromPrice = parseFloat(fromCoin.price || "0");
  const toPrice = parseFloat(toCoin.price || "0");
  if (toPrice === 0) return "0";

  return (fromPrice / toPrice).toString();
};

/**
 * Calculate swap output amount for a multi-token stable pool using oracle prices.
 * This is an estimation; the actual amount is determined by the contract's StableSwap formula.
 */
export const calculateMultiTokenSwapOutput = (
  inputAmount: string,
  pool: Pool,
  fromAddress: string,
  toAddress: string
): string => {
  if (!inputAmount || inputAmount === "0" || !pool?.coins) return "0";

  const inputAmountBigInt = BigInt(inputAmount);
  if (inputAmountBigInt <= 0n) return "0";

  // Calculate fee
  const fee = (inputAmountBigInt * BigInt(pool.swapFeeRate)) / BigInt(10000);
  const netInput = inputAmountBigInt - fee;

  const rate = getMultiTokenExchangeRate(pool, fromAddress, toAddress);
  const rateBigInt = BigInt(Math.round(parseFloat(rate) * 1e18));
  if (rateBigInt === 0n) return "0";

  return ((netInput * rateBigInt) / BigInt(1e18)).toString();
};

/**
 * Calculate required input amount for a multi-token stable pool (reverse calculation).
 */
export const calculateMultiTokenSwapInput = (
  outputAmount: string,
  pool: Pool,
  fromAddress: string,
  toAddress: string
): string => {
  if (!outputAmount || outputAmount === "0" || !pool?.coins) return "0";

  const outputAmountBigInt = BigInt(outputAmount);
  if (outputAmountBigInt <= 0n) return "0";

  const rate = getMultiTokenExchangeRate(pool, fromAddress, toAddress);
  const rateBigInt = BigInt(Math.round(parseFloat(rate) * 1e18));
  if (rateBigInt === 0n) return "0";

  // requiredInput = outputAmount / rate
  const requiredInput = (outputAmountBigInt * BigInt(1e18) + rateBigInt - 1n) / rateBigInt;

  // Add fee back: grossInput = requiredInput / (1 - feeRate/10000)
  const feeRate = BigInt(pool.swapFeeRate);
  const denominatorForFee = BigInt(10000) - feeRate;
  const grossInput = (requiredInput * BigInt(10000) + denominatorForFee - 1n) / denominatorForFee;

  return grossInput.toString();
};

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
  const ratio = isAToB ? pool.aToBRatio : pool.bToARatio;
  const numerator = pool.isStable ? netInput * BigInt(Math.round(parseFloat(ratio) * 1e18)) : netInput * outputReserve;
  const denominator = pool.isStable ? BigInt(1e18) : inputReserve + netInput;

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
  const ratio = isAToB ? pool.aToBRatio : pool.bToARatio;
  const ratioBigInt = BigInt(Math.round(parseFloat(ratio) * 1e18));
  const numerator = pool.isStable ? outputAmountBigInt * BigInt(1e18) : inputReserve * outputAmountBigInt;
  const denominator = pool.isStable ? ratioBigInt : outputReserve - outputAmountBigInt;
  
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
 * Calculate price impact
 * Price impact: I_user = (P_eff - P_before) / P_before
 * @param currentPoolPrice Current pool exchange rate (as string)
 * @param fromAmount Amount being swapped in (as string, in human-readable format)
 * @param toAmount Amount being received out (as string, in human-readable format)
 * @returns Price impact as percentage, or null if calculation not possible
 */
export const calculateImpact = (
  currentPoolPrice: string,
  fromAmount: string,
  toAmount: string
): number | null => {
  if (!currentPoolPrice || !fromAmount || !toAmount || 
      currentPoolPrice === "0" || fromAmount === "0" || toAmount === "0") {
    return null;
  }

  const poolPrice = Number(currentPoolPrice);
  const from = Number(fromAmount);
  const to = Number(toAmount);

  if (!Number.isFinite(poolPrice) || !Number.isFinite(from) || !Number.isFinite(to) || poolPrice === 0 || from === 0) {
    return null;
  }

  const effectivePrice = to / from;
  const priceImpact = Math.abs((effectivePrice - poolPrice) / poolPrice) * 100;
  
  return priceImpact;
};
