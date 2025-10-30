import { parseUnits, formatUnits } from "ethers";

/**
 * Ensures an address has the 0x prefix and proper checksum format
 * @param address - The address to format
 * @returns Address with 0x prefix and proper checksum format
 */
export const ensureHexPrefix = (address: string | undefined | null): `0x${string}` | undefined => {
  if (!address) return undefined;
  
  // Add 0x prefix if missing
  const withPrefix = address.startsWith('0x') ? address : `0x${address}`;
  
  // Convert to proper checksum format (mixed case)
  try {
    // Use viem's getAddress to get proper checksum format
    const { getAddress } = require('viem');
    return getAddress(withPrefix);
  } catch (error) {
    // If checksum conversion fails, return the address with prefix
    return withPrefix as `0x${string}`;
  }
};

/**
 * Safely parses a string to BigInt using parseUnits, handling edge cases
 * that would normally cause parseUnits to throw an error.
 * 
 * @param value - The string value to parse
 * @param decimals - The number of decimals to use for parsing
 * @returns BigInt representation of the value, or 0n if invalid
 */
export const safeParseUnits = (value: string, decimals: number = 18): bigint => {
  try {
    // Handle edge cases that parseUnits can't handle
    if (!value || value === '.') {
      return 0n;
    }
    
    // Handle incomplete decimal inputs (e.g., "35.") by treating as "35"
    if (value.endsWith('.')) {
      const numericValue = value.slice(0, -1);
      if (!numericValue) {
        return 0n;
      }
      return parseUnits(numericValue, decimals);
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

/**
 * Rounds down a decimal string to the specified number of decimal places
 * using string manipulation to avoid floating point precision issues.
 * 
 * @param value - The decimal string to round
 * @param decimals - The number of decimal places to round to
 * @returns The rounded decimal string
 */
export const roundToDecimals = (value: string, decimals: number): string => {
  if (!value || !decimals) return value;
  
  // Split by decimal point
  const parts = value.split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1] || '';
  
  // Ensure proper decimal format (add 0 if integer part is empty)
  const normalizedIntegerPart = integerPart || '0';
  
  // If no decimal part, return just the integer part
  if (!decimalPart) {
    return normalizedIntegerPart;
  }
  
  // If decimal part is shorter than required decimals, return normalized value
  if (decimalPart.length < decimals) {
    return `${normalizedIntegerPart}.${decimalPart}`;
  }
  
  // If decimal part is longer than required decimals, truncate
  if (decimalPart.length > decimals) {
    const truncatedDecimal = decimalPart.substring(0, decimals);
    return `${normalizedIntegerPart}.${truncatedDecimal}`;
  }
  
  // If decimal part is exactly the right length, return normalized value
  return `${normalizedIntegerPart}.${decimalPart}`;
};

/**
 * Adds commas to the integer part of a decimal string for better readability
 * 
 * @param value - The decimal string to format
 * @returns The formatted string with commas in the integer part
 */
export const addCommasToInput = (value: string): string => {
  if (!value) return '';
  
  const parts = value.split('.');
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  if (parts.length === 2) {
    return integerPart + '.' + parts[1];
  }
  
  return integerPart;
};

/**
 * Formats a transaction hash to show first 6 and last 4 characters
 */
export const formatHash = (hash: string): string => {
  if (hash.length > 10) {
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  }
  return hash;
};

/**
 * Formats an amount string with proper decimal handling and locale formatting
 */
export const formatAmount = (amount: string): string => {
  if (!amount) return "";
  const value = Number(amount);
  const roundedDown = Math.floor(value * 1000000) / 1000000;
  return roundedDown.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
};

/**
  * Formats a balance with symbol, from wei/smallest unit into a human-readable string.
 */
export const formatBalance = (
  balance: string | number | bigint,
  symbol?: string,
  decimals: number = 18,
  minPrecision?: number,
  maxPrecision?: number,
  isPrice?: boolean
): string => {
  const raw = BigInt(balance.toString());

  if (raw === 0n) {
    const zero = minPrecision !== undefined ? `0.${"0".repeat(minPrecision)}` : "0";
    const withSymbol = symbol ? `${zero} ${symbol}` : zero;
    return isPrice ? `$${withSymbol}` : withSymbol;
  }
  
  const formatted = formatUnits(raw, decimals); // e.g., "1234.56789"

  let [int, dec = ""] = formatted.split(".");

  if (maxPrecision !== undefined && dec.length > maxPrecision) {
    dec = dec.substring(0, maxPrecision);
  }

  if (minPrecision !== undefined && dec.length < minPrecision) {
    dec = dec.padEnd(minPrecision, "0");
  }

  const localized = Number(int).toLocaleString();
  const result = dec ? `${localized}.${dec}` : localized;

  const withSymbol = symbol ? `${result} ${symbol}` : result;
  return isPrice ? `$${withSymbol}` : withSymbol;
};

/**
 * Formats a Wei amount to human readable format with decimal cleanup
 */
export const formatWeiAmount = (weiAmount: string, decimals: number = 18): string => {
  try {
    const formatted = formatUnits(BigInt(weiAmount), decimals);
    // Remove trailing zeros after decimal point and limit to 6 decimal places
    if (formatted.includes('.')) {
      const cleaned = formatted.replace(/(\.\d*?[1-9])0+$/g, '$1').replace(/\.0+$/, '');
      // Limit to 6 decimal places
      const parts = cleaned.split('.');
      if (parts.length === 2 && parts[1].length > 6) {
        return `${parts[0]}.${parts[1].substring(0, 6)}`;
      }
      return cleaned;
    }
    return formatted;
  } catch (error) {
    console.error('Error formatting wei amount:', error);
    return weiAmount; // Return original if formatting fails
  }
};

/**
 * Formats currency values with proper locale formatting
 */
export const formatCurrency = (value: string | number): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return "0.00";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
};

export const toWei = (s: string): bigint => BigInt(s || "0");

/**
 * Convert wei string to decimal for display with high precision (handles raw integer strings from backend)
 * This function properly handles BigInt conversion and decimal trimming, preserving all significant digits
 */
export const formatWeiToDecimalHP = (weiString: string, decimals: number): string => {
  if (!weiString || weiString === '0') return '0';
  
  const wei = BigInt(weiString);
  const divisor = BigInt(10) ** BigInt(decimals);
  const quotient = wei / divisor;
  const remainder = wei % divisor;
  
  if (remainder === 0n) {
    return quotient.toString();
  }
  
  // For non-zero remainder, show decimal places
  const decimalPart = remainder.toString().padStart(decimals, '0');
  const trimmedDecimal = decimalPart.replace(/0+$/, ''); // Remove trailing zeros
  
  if (trimmedDecimal === '') {
    return quotient.toString();
  }
  
  return `${quotient}.${trimmedDecimal}`;
};

/**
 * Format large numbers for display with K/M/B notation
 * Handles very large numbers with scientific notation
 */
export const formatNumber = (num: number | string, decimals: number = 2): string => {
  const value = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(value)) return '0';
  
  // For very large numbers, use scientific notation
  if (value >= 1e21) {
    return value.toExponential(2);
  }
  
  // For large numbers, use K/M/B notation
  if (value >= 1e9) {
    return (value / 1e9).toFixed(1) + 'B';
  }
  if (value >= 1e6) {
    return (value / 1e6).toFixed(1) + 'M';
  }
  if (value >= 1e3) {
    return (value / 1e3).toFixed(1) + 'K';
  }
  
  // For normal numbers, limit decimal places
  return value.toFixed(decimals);
};

/**
 * Convert decimal string to wei with exact precision (no floating point arithmetic)
 * Always preserves full precision by using string manipulation and BigInt arithmetic
 * 
 * @param decimal - The decimal value as string (required for exact precision)
 * @param decimals - The number of decimal places for the token (default: 18)
 * @returns Wei amount as string
 */
export const formatDecimalToWeiHP = (
  decimal: string, 
  decimals: number = 18
): string => {
  if (!decimal || decimal === '0' || decimal === '') return '0';
  
  // Remove any leading/trailing whitespace
  const cleanDecimal = decimal.trim();
  
  // Handle negative numbers
  const isNegative = cleanDecimal.startsWith('-');
  const absoluteDecimal = isNegative ? cleanDecimal.slice(1) : cleanDecimal;
  
  // Split into whole and decimal parts
  const parts = absoluteDecimal.split('.');
  const wholePart = parts[0] || "0";
  const decimalPart = parts[1] || "";
  
  // Validate input - only digits allowed
  if (!/^\d+$/.test(wholePart) || (decimalPart && !/^\d+$/.test(decimalPart))) {
    throw new Error(`Invalid decimal string: ${decimal}`);
  }
  
  // Pad or truncate decimal part to exact precision
  const paddedDecimalPart = decimalPart.padEnd(decimals, '0').slice(0, decimals);
  
  // Convert to wei using BigInt arithmetic
  const wholeWei = BigInt(wholePart) * (BigInt(10) ** BigInt(decimals));
  const decimalWei = BigInt(paddedDecimalPart);
  const totalWei = wholeWei + decimalWei;
  
  return isNegative ? `-${totalWei.toString()}` : totalWei.toString();
};

export { formatUnits } from "ethers";
