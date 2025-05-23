
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
