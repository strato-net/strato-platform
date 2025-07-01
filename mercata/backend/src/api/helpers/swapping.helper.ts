export const getInputPrice = (
  inputAmount: bigint,
  inputReserve: bigint,
  outputReserve: bigint
): string => {
  if (inputAmount <= BigInt(0) || inputReserve <= BigInt(0) || outputReserve <= BigInt(0)) {
    throw new Error("Invalid amounts or reserves");
  }

  const numerator = inputAmount * outputReserve;
  const denominator = inputReserve + inputAmount;

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
  // If the forward formula is: outputAmount = (inputAmount * outputReserve) / (inputReserve + inputAmount)
  // Then the reverse is: inputAmount = (inputReserve * outputAmount) / (outputReserve - outputAmount)
  
  const numerator = inputReserve * outputAmount;
  const denominator = outputReserve - outputAmount;
  
  // Add 1 to round up (to ensure user provides enough input)
  return String(numerator / denominator + BigInt(1));
};