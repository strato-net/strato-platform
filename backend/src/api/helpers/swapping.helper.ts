export const getInputPrice = (
  inputAmount: bigint,
  inputReserve: bigint,
  outputReserve: bigint
): string => {
  if (inputAmount <= 0n || inputReserve <= 0n || outputReserve <= 0n) {
    throw new Error("Invalid amounts or reserves");
  }

  const inputAmountWithFee = inputAmount * 1000n;
  const numerator = inputAmountWithFee * outputReserve;
  const denominator = inputReserve * 1000n + inputAmountWithFee;

  return String(numerator / denominator);
};
