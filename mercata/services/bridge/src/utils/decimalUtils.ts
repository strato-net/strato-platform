/**
 * Converts an amount from one decimal place to another
 * @param amount - The amount as BigInt or string (hex/decimal)
 * @param fromDecimals - Source decimal places
 * @param toDecimals - Target decimal places
 * @returns The converted amount as BigInt
 */
export function convertDecimals(
  amount: string | bigint,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  // Parse the amount to BigInt (handles both hex and decimal strings)
  const amountBigInt = typeof amount === "bigint" ? amount : BigInt(amount);

  if (fromDecimals === toDecimals) {
    return amountBigInt;
  }

  if (fromDecimals > toDecimals) {
    // Need to divide by 10^(fromDecimals - toDecimals)
    const divisor = BigInt(10) ** BigInt(fromDecimals - toDecimals);
    return amountBigInt / divisor;
  } else {
    // Need to multiply by 10^(toDecimals - fromDecimals)
    const multiplier = BigInt(10) ** BigInt(toDecimals - fromDecimals);
    return amountBigInt * multiplier;
  }
}

/**
 * Converts an amount from external token decimals to STRATO decimals (18)
 * @param amount - The amount as BigInt or string (hex/decimal)
 * @param extDecimals - External token decimal places
 * @returns The converted amount as decimal string for STRATO contracts
 */
export function convertToStratoDecimals(
  amount: string | bigint,
  extDecimals: number,
): string {
  const converted = convertDecimals(amount, extDecimals, 18);
  return converted.toString();
}

/**
 * Converts an amount from STRATO decimals (18) to external token decimals
 * @param amount - The amount as BigInt or string (hex/decimal)
 * @param extDecimals - External token decimal places
 * @returns The converted amount as hex string for external chain contracts
 */
export function convertFromStratoDecimals(
  amount: string | bigint,
  extDecimals: number,
): string {
  const converted = convertDecimals(amount, 18, extDecimals);
  return `0x${converted.toString(16)}`;
}
