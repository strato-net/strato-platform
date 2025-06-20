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

export const getRequiredInput = (
  outputAmount: bigint,
  inputReserve: bigint,
  outputReserve: bigint
): string => {
  if (outputAmount <= BigInt(0) || inputReserve <= BigInt(0) || outputReserve <= BigInt(0)) {
    throw new Error("Invalid amounts or reserves");
  }
  
  if (outputAmount >= outputReserve) {
    throw new Error("Desired output amount exceeds pool reserves");
  }

  // This is the inverse of the getInputPrice formula
  // If the forward formula is: outputAmount = (inputAmount * 1000 * outputReserve) / (inputReserve * 1000 + inputAmount * 1000)
  // Then the reverse is: inputAmount = (inputReserve * outputAmount * 1000) / ((outputReserve - outputAmount) * 1000)
  
  const numerator = inputReserve * outputAmount * BigInt(1000);
  const denominator = (outputReserve - outputAmount) * BigInt(1000); // 1000 because of 0.3% fee
  
  // Add 1 to round up (to ensure user provides enough input)
  return String(numerator / denominator + BigInt(1));
};