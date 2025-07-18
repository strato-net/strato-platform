import { parseUnits } from "ethers";

/**
 * Safely parses a string to BigInt using parseUnits, handling edge cases
 * that would normally cause parseUnits to throw an error.
 * 
 * @param value - The string value to parse
 * @param decimals - The number of decimals to use for parsing
 * @returns BigInt representation of the value, or 0n if invalid
 */
export const safeParseUnits = (value: string, decimals: number): bigint => {
  try {
    // Handle edge cases that parseUnits can't handle
    if (!value || value === '.' || value === '0.' || value.endsWith('.')) {
      return 0n;
    }
    return parseUnits(value, decimals);
  } catch {
    return 0n;
  }
};

/**
 * Safely parses a string to a number, handling invalid inputs
 * 
 * @param value - The string value to parse
 * @returns number representation of the value, or 0 if invalid
 */
export const safeParseFloat = (value: string): number => {
  if (!value) return 0;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
};