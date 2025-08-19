/** Zero address constant for filtering */
export const ZERO_ADDRESS = "0000000000000000000000000000000000000000";

/** Validate that a string is a well-formed URL */
const isValidUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * Calculate the on-chain payment amount with margin, rounding, and a minimum floor.
 */
function calculateTotalAmount(
  amount: string,
  price: string,
  marginBps: string
): string {
  const amountBigInt = BigInt(amount);
  const priceBigInt = BigInt(price);
  const divisor = BigInt(10 ** 16);
  const marginMultiplier = BigInt(10000 + Number(marginBps));
  const marginDivisor = BigInt(10000);
  const rawAmount =
    (amountBigInt * priceBigInt * marginMultiplier +
      (divisor * marginDivisor) / 2n) /
    (divisor * marginDivisor);
  const total = Math.max(Number(rawAmount.toString()), 50);
  return total.toString();
}

export { isValidUrl, calculateTotalAmount };