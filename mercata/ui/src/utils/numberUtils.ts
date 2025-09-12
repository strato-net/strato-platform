import { parseUnits, formatUnits } from "ethers";

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

  if (maxPrecision !== undefined) {
    const rounded = Number(formatted).toFixed(maxPrecision);
    [int, dec = ""] = rounded.split(".");
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
export const formatWeiAmount = (weiAmount: string | bigint, decimals: number = 18): string => {
  try {
    const formatted = formatUnits(typeof weiAmount === 'string' ? BigInt(weiAmount) : weiAmount, decimals);
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
    return '0'; // Return 0 if formatting fails
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

/**
 * Simplified formatting helper for bigint values
 * @param v - The bigint value to format
 * @param dec - Number of decimals (default: 18)
 * @param min - Minimum decimal places (default: 2)
 * @param max - Maximum decimal places (default: 6)
 * @returns Formatted string
 */
export const fmt = (v: bigint, dec = 18, min = 2, max = 6) => formatBalance(v, undefined, dec, min, max);

/**
 * Formats max amount display with proper decimal handling and approximation symbol
 * @param maxTransferable - The max transferable amount in wei
 * @param tokenSymbol - The token symbol (e.g., "USDST", "GOLDST")
 * @param decimals - Number of decimals for the token
 * @returns Formatted display string
 */
export const formatMaxDisplay = (maxTransferable: bigint, tokenSymbol: string, decimals: number): string => {
  if (maxTransferable === 0n) return `0 ${tokenSymbol}`;
  
  const formatted = fmt(maxTransferable, decimals);
  const numericPart = formatted.split(' ')[0];
  const numericValue = parseFloat(numericPart);
  
  // If very small (less than 0.0000001), show ⪆0
  if (numericValue < 0.0000001) {
    return `⪆0 ${tokenSymbol}`;
  }
  
  // For amounts >= 0.0000001, show up to 7 decimals without trailing zeros
  const parts = numericPart.split('.');
  if (parts.length === 2) {
    const decimalPart = parts[1].substring(0, 7).replace(/0+$/, '');
    const cleanAmount = decimalPart ? `${parts[0]}.${decimalPart}` : parts[0];
    return `${cleanAmount} ${tokenSymbol}`;
  }
  
  return `${numericPart} ${tokenSymbol}`;
};

// Re-export formatUnits for convenience
export { formatUnits, parseUnits } from "ethers";