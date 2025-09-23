// ---------------- BigInt Validation Utilities ----------------

/**
 * Safely converts a string to BigInt with validation
 */
export const safeBigInt = (value: string | number | bigint): bigint => {
  if (typeof value === 'bigint') return value;
  
  const stringValue = value.toString();
  
  // Check if the string represents a valid number
  if (!/^-?\d+$/.test(stringValue)) {
    throw new Error(`Invalid BigInt value: ${stringValue}`);
  }
  
  try {
    return BigInt(stringValue);
  } catch (error) {
    throw new Error(`Failed to convert to BigInt: ${stringValue}`);
  }
};

/**
 * Safely converts a string to BigInt with default value
 */
export const safeBigIntOrDefault = (value: string | number | bigint | undefined, defaultValue: bigint = 0n): bigint => {
  if (value === undefined || value === null) return defaultValue;
  return safeBigInt(value);
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
  return /^-?\d+$/.test(value);
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
  
  const fullInteger = integerPart + paddedDecimal;
  
  return safeBigInt(fullInteger);
};

/**
 * Formats BigInt to decimal string with specified decimals
 */
export const formatBigIntToDecimal = (value: bigint, decimals: number = 18): string => {
  const stringValue = value.toString();
  
  if (stringValue.length <= decimals) {
    return '0.' + stringValue.padStart(decimals, '0');
  }
  
  const integerPart = stringValue.slice(0, -decimals);
  const decimalPart = stringValue.slice(-decimals);
  
  return integerPart + '.' + decimalPart;
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
