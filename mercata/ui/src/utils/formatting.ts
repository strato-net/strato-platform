import { formatUnits } from "ethers";

export const formatBalance = (value: number): string => {
  if (typeof value !== "number" || isNaN(value) || !isFinite(value)) return "0.00";

  return value.toLocaleString("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  });
}

/**
 * Formats a balance with symbol, handling BigInt conversion and decimal cleanup
 */
export const formatBalanceWithSymbol = (balance: string | number | bigint, symbol: string, decimal: number = 18): string => {
  let formatted = formatUnits(BigInt(balance.toString()), decimal);
  if (formatted.includes('.')) {
    formatted = formatted.replace(/(\.\d*?[1-9])0+$/g, '$1').replace(/\.0+$/, '');
  }
  return `${formatted} ${symbol}`;
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

/**
 * Formats a Wei amount to human readable format upto 2 decimals
 */
export const formatBalanceForDashboard = (balance: string) =>
    balance ? Number(formatUnits(balance, 18)).toFixed(2) : "0.00";