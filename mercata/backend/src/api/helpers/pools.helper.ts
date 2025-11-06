
export const getInputPrice = (
  inputAmount: bigint,
  inputReserve: bigint,
  outputReserve: bigint
): bigint => {
  if (inputAmount <= 0n || inputReserve <= 0n || outputReserve <= 0n) {
    throw new Error("Invalid amounts or reserves");
  }

  const inputAmountWithFee = inputAmount * 1000n;
  const numerator = inputAmountWithFee * outputReserve;
  const denominator = inputReserve * 1000n + inputAmountWithFee;

  return numerator / denominator;
};

export const getOutputPrice = (
  outputAmount: bigint,
  inputReserve: bigint,
  outputReserve: bigint
): bigint => {
  if (outputAmount <= 0n || inputReserve <= 0n || outputReserve <= 0n) {
    throw new Error("Invalid amounts or reserves");
  }

  if (outputAmount >= outputReserve) {
    throw new Error("Insufficient liquidity");
  }

  const numerator = inputReserve * outputAmount * 1000n;
  const denominator = (outputReserve - outputAmount) * 1000n;

  return numerator / denominator + 1n;
};

/**
 * Calculate integer square root of a BigInt (Babylonian method)
 * Matches the contract's _sqrt function
 */
export const sqrt = (y: bigint): bigint => {
  if (y > 3n) {
    let z = y;
    let x = y / 2n + 1n;
    while (x < z) {
      z = x;
      x = (y / x + x) / 2n;
    }
    return z;
  } else if (y !== 0n) {
    return 1n;
  }
  return 0n;
};

/**
 * Compute optimal swap amount for single-sided liquidity (generic fee)
 * Matches the contract's _getOptimalSwapAmount function
 * @param reserveIn Current reserve of the input token
 * @param userIn Total amount the user is depositing
 * @param feeBps Fee in basis points (e.g., 30 = 0.3%)
 * @returns Optimal amount to swap
 */
export const getOptimalSwapAmount = (
  reserveIn: bigint,
  userIn: bigint,
  feeBps: bigint
): bigint => {
  if (feeBps >= 10000n) {
    throw new Error("Fee too high");
  }

  const a = 10000n - feeBps; // effective multiplier (e.g., 9970 for 0.3%)
  const b = 10000n;
  
  // term = sqrt( reserveIn * ( userIn * 4 * a * b + reserveIn * (a + b) ** 2 ) )
  const term1 = userIn * 4n * a * b;
  const term2 = reserveIn * (a + b) * (a + b);
  const term = sqrt(reserveIn * (term1 + term2));
  const numerator = term - reserveIn * (a + b);
  
  return numerator / (2n * a);
};

/**
 * Calculate swap output amount accounting for fees
 * Matches the contract's swap calculation logic (using getInputPrice with net input)
 * @param amountIn Input amount
 * @param inputReserve Current input token reserve
 * @param outputReserve Current output token reserve
 * @param swapFeeRate Swap fee rate in basis points
 * @returns Output amount after fees
 */
export const calculateSwapOutput = (
  amountIn: bigint,
  inputReserve: bigint,
  outputReserve: bigint,
  swapFeeRate: bigint
): bigint => {
  if (amountIn <= 0n || inputReserve <= 0n || outputReserve <= 0n) {
    throw new Error("Invalid amounts or reserves");
  }

  // Calculate fee
  const fee = (amountIn * swapFeeRate) / 10000n;
  const netInput = amountIn - fee;

  // Calculate output using constant product formula: output = (netInput * outputReserve) / (inputReserve + netInput)
  const numerator = netInput * outputReserve;
  const denominator = inputReserve + netInput;
  
  return numerator / denominator;
};
