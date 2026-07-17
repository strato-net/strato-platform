// ---------------- BigInt Validation Utilities ----------------

/**
 * Safely converts a string to BigInt with validation, handling scientific notation and decimals (truncating).
 */
export const safeBigInt = (value: string | number | bigint): bigint => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid BigInt value: ${value}`);
    }
    return BigInt(Math.trunc(value));
  }
  
  const trimmed = value.toString().trim();
  if (trimmed === "") {
    throw new Error("Invalid BigInt value: empty string");
  }

  // Pure integer string - direct conversion
  if (/^-?\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }

  // Scientific notation (e.g., "5e+22", "1.5e10", "3E18")
  const sciMatch = trimmed.match(/^(-?\d+\.?\d*)[eE]([+-]?\d+)$/);
  if (sciMatch) {
    const [, mantissa, exponent] = sciMatch;
    const exp = parseInt(exponent, 10);

    // Split mantissa into integer and decimal parts
    const [intPart, decPart = ""] = mantissa.replace("-", "").split(".");
    const isNegative = mantissa.startsWith("-");

    // Combine and shift decimal point
    const combined = intPart + decPart;
    const shift = exp - decPart.length;

    let result: string;
    if (shift >= 0) {
      result = combined + "0".repeat(shift);
    } else {
      // Truncate decimals (floor toward zero)
      const cutPoint = combined.length + shift;
      result = cutPoint > 0 ? combined.slice(0, cutPoint) : "0";
    }

    return BigInt(isNegative ? "-" + result : result);
  }

  // Decimal number without exponent - truncate to integer
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    const intPart = trimmed.split(".")[0];
    return BigInt(intPart || "0");
  }
  
  try {
    return BigInt(trimmed);
  } catch (error) {
    throw new Error(`Invalid BigInt value: ${trimmed}`);
  }
};

/**
 * Safely converts a string to BigInt with default value
 */
export const safeBigIntOrDefault = (value: string | number | bigint | undefined | null, defaultValue: bigint = 0n): bigint => {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === "")) return defaultValue;
  try {
    return safeBigInt(value);
  } catch (error) {
    return defaultValue;
  }
};

/**
 * Validates that a BigInt value is positive
 */
export const validatePositiveBigInt = (value: bigint, fieldName: string = 'value'): void => {
  if (value <= 0n) {
    throw new Error(`${fieldName} must be positive, got: ${value.toString()}`);
  }
};

/**
 * Safely performs BigInt division with zero check
 */
export const safeBigIntDivide = (dividend: bigint, divisor: bigint, fieldName: string = 'division'): bigint => {
  if (divisor === 0n) {
    throw new Error(`${fieldName}: Division by zero`);
  }
  return dividend / divisor;
};

/**
 * Converts BigInt to string with proper formatting
 */
export const bigIntToString = (value: bigint): string => {
  return value.toString();
};

/**
 * Validates that a string represents a valid numeric value for BigInt conversion
 */
export const isValidBigIntString = (value: string): boolean => {
  const trimmed = value.trim();
  return /^-?\d+$/.test(trimmed) ||
         /^(-?\d+\.?\d*)[eE]([+-]?\d+)$/.test(trimmed) ||
         /^-?\d+\.\d+$/.test(trimmed);
};

/**
 * Parses a decimal string to BigInt with specified decimals
 */
export const parseDecimalToBigInt = (decimalString: string, decimals: number = 18): bigint => {
  if (!/^\d*\.?\d+$/.test(decimalString)) {
    throw new Error(`Invalid decimal format: ${decimalString}`);
  }
  
  const [integerPart, decimalPart = ''] = decimalString.split('.');
  
  // Pad or truncate decimal part to match decimals
  const paddedDecimal = decimalPart.padEnd(decimals, '0').slice(0, decimals);
  
  const fullInteger = (integerPart || "0") + paddedDecimal;
  
  return BigInt(fullInteger);
};

/**
 * Formats BigInt to decimal string with specified decimals
 */
export const formatBigIntToDecimal = (value: bigint, decimals: number = 18): string => {
  const stringValue = value.toString();
  const isNegative = stringValue.startsWith('-');
  const absoluteValue = isNegative ? stringValue.slice(1) : stringValue;
  
  let result: string;
  if (absoluteValue.length <= decimals) {
    result = '0.' + absoluteValue.padStart(decimals, '0');
  } else {
    const integerPart = absoluteValue.slice(0, -decimals);
    const decimalPart = absoluteValue.slice(-decimals);
    result = integerPart + '.' + decimalPart;
  }
  
  return isNegative ? '-' + result : result;
};

/**
 * Calculates percentage of a BigInt value
 */
export const calculateBigIntPercentage = (value: bigint, percentage: number): bigint => {
  if (percentage < 0 || percentage > 100) {
    throw new Error(`Percentage must be between 0 and 100, got: ${percentage}`);
  }
  
  return (value * BigInt(Math.round(percentage * 100))) / 10000n;
};

/**
 * Applies slippage tolerance to a BigInt value
 */
export const applySlippageTolerance = (value: bigint, slippageBps: number): bigint => {
  if (slippageBps < 0 || slippageBps > 10000) {
    throw new Error(`Slippage must be between 0 and 10000 basis points, got: ${slippageBps}`);
  }
  
  const tolerance = 10000 - slippageBps;
  return (value * BigInt(tolerance)) / 10000n;
};
