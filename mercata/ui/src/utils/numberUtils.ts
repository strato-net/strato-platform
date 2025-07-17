import { formatUnits, parseUnits } from "ethers";

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

export const generatePriceData = (basePrice: number, days: number = 30) => {
  const data = [];
  let currentPrice = basePrice;

  for (let i = 0; i < days; i++) {
    // Random price fluctuation between -2% and +2%
    const change = currentPrice * (Math.random() * 0.04 - 0.02);
    currentPrice += change;

    data.push({
      date: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000).toLocaleDateString(),
      price: formatUnits(currentPrice?.toLocaleString("fullwide", { useGrouping: false }), 18),
    });
  }

  return data;
};

// Calculate health factor color based on value
export const getHealthFactorColor = (healthFactor: number) => {
  if (healthFactor >= 1.5) return "text-green-600";
  if (healthFactor >= 1.2) return "text-yellow-600";
  if (healthFactor >= 1.0) return "text-orange-600";
  return "text-red-600";
};

export const truncateAddress = (address: string | null | undefined) => {
  if (!address) return "N/A";
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};


export const weiToEth = (v?: string | number | bigint | null): number => {
  if (v === undefined || v === null) return 0;
  try {
    return Number(BigInt(v)) / 1e18;
  } catch {
    return 0;
  }
};

export const ethToWei = (eth: number): string => {
  if (!isFinite(eth) || eth <= 0) return "0";
  return BigInt(Math.floor(eth * 1e18)).toString();
};

export const formatBalance = (value: number): string => {
  if (typeof value !== "number" || isNaN(value) || !isFinite(value)) return "0.00";

  return value.toLocaleString("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  });
}

export const formatBalanceWithSymbol = (balance: string | number | bigint, symbol: string, decimal: number = 18): string => {
  let formatted = formatUnits(BigInt(balance.toString()), decimal);
  if (formatted.includes('.')) {
    formatted = formatted.replace(/(\.\d*?[1-9])0+$/g, '$1').replace(/\.0+$/, '');
  }
  return `${formatted} ${symbol}`;
};