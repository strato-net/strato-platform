import { Pool } from "@/interface";
import { safeParseUnits } from "@/utils/numberUtils";

const BPS_DENOMINATOR = 10000n;

const sqrtBigInt = (value: bigint): bigint => {
  if (value <= 1n) return value;

  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }

  return x;
};

/**
 * Check if a pool is a multi-token pool (more than 2 coins)
 */
export const isMultiTokenPool = (pool: Pool): boolean => {
  return !!(pool.coins && pool.coins.length > 2);
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

export const calculateSingleTokenLiquidityMint = (
  inputAmount: string,
  pool: Pool,
  isAToB: boolean
): string => {
  if (!inputAmount || inputAmount === "0") return "0";

  const amountIn = safeParseUnits(inputAmount, 18);
  const totalLiquidity = BigInt(pool.lpToken._totalSupply || "0");
  if (amountIn <= 0n || totalLiquidity <= 0n) return "0";

  const reserveIn = isAToB
    ? BigInt(pool.tokenA.poolBalance || "0")
    : BigInt(pool.tokenB.poolBalance || "0");
  const reserveOut = isAToB
    ? BigInt(pool.tokenB.poolBalance || "0")
    : BigInt(pool.tokenA.poolBalance || "0");
  if (reserveIn <= 0n || reserveOut <= 0n) return "0";

  const feeRate = BigInt(pool.swapFeeRate || 0);
  const lpShareRate = BigInt(pool.lpSharePercent || 0);
  const effectiveMultiplier = BPS_DENOMINATOR - feeRate;
  if (effectiveMultiplier <= 0n) return "0";

  const sqrtTerm = sqrtBigInt(
    reserveIn *
      (amountIn * 4n * effectiveMultiplier * BPS_DENOMINATOR +
        reserveIn * (effectiveMultiplier + BPS_DENOMINATOR) * (effectiveMultiplier + BPS_DENOMINATOR))
  );
  const numerator = sqrtTerm - reserveIn * (effectiveMultiplier + BPS_DENOMINATOR);
  if (numerator <= 0n) return "0";

  const swapAmount = numerator / (2n * effectiveMultiplier);
  const fee = (swapAmount * feeRate) / BPS_DENOMINATOR;
  const lpFee = (fee * lpShareRate) / BPS_DENOMINATOR;
  const protocolFee = fee - lpFee;
  const netInput = swapAmount - fee;
  if (netInput <= 0n) return "0";

  const amountOut = (netInput * reserveOut) / (reserveIn + netInput);
  if (amountOut <= 0n) return "0";

  const postA = isAToB
    ? reserveIn + swapAmount - protocolFee
    : BigInt(pool.tokenA.poolBalance || "0") - amountOut;
  const postB = isAToB
    ? BigInt(pool.tokenB.poolBalance || "0") - amountOut
    : reserveIn + swapAmount - protocolFee;
  if (postA <= 0n || postB <= 0n) return "0";

  const requiredA = isAToB ? (amountOut * postA) / postB : amountOut;
  const requiredB = isAToB ? amountOut : (amountOut * postB) / postA;
  const totalNeeded = isAToB ? swapAmount + requiredA : swapAmount + requiredB;
  if (totalNeeded > amountIn) return "0";

  const tokenAAmount = isAToB ? requiredA : amountOut;
  const tokenBAmount = isAToB ? amountOut : requiredB;
  const liquidityA = (tokenAAmount * totalLiquidity) / postA;
  const liquidityB = (tokenBAmount * totalLiquidity) / postB;
  const minted = liquidityA < liquidityB ? liquidityA : liquidityB;

  return minted > 0n ? minted.toString() : "0";
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
