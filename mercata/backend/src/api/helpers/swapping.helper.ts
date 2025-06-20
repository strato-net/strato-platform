export const getInputPrice = (
  inputAmount: bigint,
  inputReserve: bigint,
  outputReserve: bigint
): string => {
  if (inputAmount <= BigInt(0) || inputReserve <= BigInt(0) || outputReserve <= BigInt(0)) {
    throw new Error("Invalid amounts or reserves");
  }

  const inputAmountWithFee = inputAmount * BigInt(1000);
  const numerator = inputAmountWithFee * outputReserve;
  const denominator = inputReserve * BigInt(1000) + inputAmountWithFee;

  return String(numerator / denominator);
};
