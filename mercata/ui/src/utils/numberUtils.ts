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
 * Safely convert a value to BigInt, handling numbers in scientific notation
 */
export const safeBigInt = (value: string | number | bigint | undefined | null): bigint => {
  if (value === undefined || value === null) return 0n;
  if (typeof value === 'bigint') return value;
  
  const str = String(value);
  if (!str || str === "0") return 0n;
  
  // If it's in scientific notation, convert it properly
  if (str.includes('e') || str.includes('E')) {
    const num = parseFloat(str);
    if (isNaN(num) || !isFinite(num)) return 0n;
    
    // Parse scientific notation manually to avoid precision issues
    const parts = str.toLowerCase().split('e');
    if (parts.length === 2) {
      const baseStr = parts[0];
      const exponent = parseInt(parts[1]);
      
      if (!isNaN(exponent)) {
        const baseParts = baseStr.split('.');
        const integerPart = baseParts[0] || '0';
        const decimalPart = baseParts[1] || '';
        
        if (exponent > 0) {
          // Move decimal point to the right
          if (exponent >= decimalPart.length) {
            // All decimal digits become integer digits, pad with zeros
            const newInteger = integerPart + decimalPart + '0'.repeat(exponent - decimalPart.length);
            return BigInt(newInteger);
          } else {
            // Some decimal digits remain (shouldn't happen for integers, but handle it)
            const newInteger = integerPart + decimalPart.substring(0, exponent);
            return BigInt(newInteger);
          }
        } else {
          // Move decimal point to the left (makes number smaller, so for BigInt we round to 0)
          return 0n;
        }
      }
    }
    
    // Fallback: try toLocaleString which handles large numbers better
    try {
      // Use a locale that doesn't use grouping and shows full precision
      const fixed = num.toLocaleString('en-US', { 
        useGrouping: false, 
        maximumFractionDigits: 0,
        notation: 'standard'
      });
      return BigInt(fixed);
    } catch {
      // Last resort: floor the number and convert
      const sign = num < 0 ? '-' : '';
      const absNum = Math.abs(num);
      // For very large numbers, Math.floor might lose precision, but it's our last option
      const integerPart = Math.floor(absNum);
      return BigInt(sign + integerPart.toString());
    }
  }
  
  // Remove any decimal point and everything after it for BigInt conversion
  const cleanStr = str.split('.')[0];
  if (!cleanStr || cleanStr === '') return 0n;
  return BigInt(cleanStr);
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
  const raw = safeBigInt(balance);

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
    const formatted = formatUnits(safeBigInt(weiAmount), decimals);
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

export const toWei = (s: string): bigint => safeBigInt(s || "0");

/**
 * Convert wei string to decimal for display with high precision (handles raw integer strings from backend)
 * This function properly handles BigInt conversion and decimal trimming, preserving all significant digits
 */
export const formatWeiToDecimalHP = (weiString: string, decimals: number): string => {
  if (!weiString || weiString === '0') return '0';
  
  const wei = safeBigInt(weiString);
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

/**
 * Calculates the dollar value of a token by multiplying balance and price.
 * Both values are expected to be in 18-decimal wei format.
 * 
 * @param rawBalance - Token balance in wei (18 decimals)
 * @param rawPrice - Token price in wei (18 decimals)
 * @param rawCollateral - Optional collateral balance in wei (18 decimals)
 * @returns Dollar value as a formatted string with 2 decimal places
 */
export const calculateTokenValue = (
  rawBalance: string | number | bigint,
  rawPrice: string | number | bigint,
  rawCollateral?: string | number | bigint
): string => {
  if (!rawPrice || rawPrice === "0" || rawPrice === 0 || rawPrice === 0n) return "0.00";

  try {
    const balance = rawBalance 
      ? parseFloat(formatUnits(safeBigInt(rawBalance), 18))
      : 0;
    const price = parseFloat(formatUnits(safeBigInt(rawPrice), 18));
    const collateral = rawCollateral 
      ? parseFloat(formatUnits(safeBigInt(rawCollateral), 18))
      : 0;
    
    const totalBalance = balance + collateral;
    const value = totalBalance * price;

    return value.toFixed(2);
  } catch (error) {
    return "0.00";
  }
};

export { formatUnits } from "ethers";

import { jsonrepair } from "jsonrepair";
import JSONBigInt from "json-bigint";

// Configure JSON parser with native BigInt support for handling large numbers (e.g., wei values)
const J = JSONBigInt({ useNativeBigInt: true });

// Safe character normalization: removes problematic Unicode characters
// - Removes BOM (Byte Order Mark) and zero-width spaces
// - Replaces non-breaking spaces with regular spaces
// - Converts Unicode smart quotes to standard ASCII quotes
const normalize = (s: string) =>
  s
    .replace(/[\uFEFF\u200B]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

// Converts \822x escape sequences to smart quotes first (JSON-safe),
// which will then be normalized to ASCII quotes via normalize()
// This avoids creating ""word"" artifacts that break JSON parsing
const fix822x = (s: string) =>
  s
    .replace(/\\8220/g, "\u201C")
    .replace(/\\8221/g, "\u201D")
    .replace(/\\8216/g, "\u2018")
    .replace(/\\8217/g, "\u2019");

// Targeted fix: only collapses ""word"" when it appears as a JSON token pattern
// (e.g., :""transfer"" or ,""transfer"") to avoid rewriting valid content elsewhere
const collapseDoubledQuotesToken = (s: string) =>
  s.replace(/:\s*""([^"]+)""/g, ':"$1"').replace(/,\s*""([^"]+)""/g, ',"$1"');

// Parses JSON string: normalizes characters, repairs malformed JSON, then parses with BigInt support
const parseText = (s: string) => J.parse(jsonrepair(normalize(fix822x(s))));

/**
 * Parses JSON strings with BigInt support, handling malformed JSON and Unicode issues.
 * Attempts double parsing: if the first parse returns a string, tries parsing again
 * (handles cases where JSON is double-encoded as a string).
 * 
 * The inner layer fix (collapseDoubledQuotesToken) is only applied to the parsed string,
 * not the raw input, to avoid rewriting valid content in unintended places.
 * 
 * @param input - JSON string to parse (may be malformed or contain Unicode issues)
 * @param fallback - Value to return if parsing fails (defaults to null)
 * @param label - Label for error logging (defaults to "parseJsonBigInt")
 * @returns Parsed value with BigInt support, or fallback if parsing fails
 */
export const parseJsonBigInt = <T>(
  input: string,
  { fallback = null as T | null, label = "parseJsonBigInt" } = {}
): unknown | T => {
  try {
    const v = parseText(input);
    // If result is a string, it might be double-encoded JSON - try parsing again
    if (typeof v !== "string") return v;
    try {
      // Inner layer only: handle the ""transfer"" artifact if it exists in the nested JSON
      return parseText(collapseDoubledQuotesToken(v));
    } catch {
      // If second parse fails, return the string value as-is
      return v;
    }
  } catch (e) {
    console.error(`[${label}] failed`, {
      err: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    });
    return fallback;
  }
};
