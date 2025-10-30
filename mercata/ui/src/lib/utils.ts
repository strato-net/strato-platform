import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function calculateLTV(token) {
  const DECIMALS = 18n;

  const value = BigInt(token.value);
  const price = BigInt(token.price);
  // Assume value is in smallest units (e.g., wei), divide by 10^18 to get token amount
  const tokenAmount = value / 10n ** DECIMALS;
  // Collateral value in base units (e.g., wei of USD)
  const collateralValue = tokenAmount * price;
  // Loan amount in base units (same as `value`)
  const loanValue = value;
  const ltv = (loanValue * 10000n) / collateralValue; // Multiplied by 10000 for 2 decimal precision
  return Number(ltv) / 100;
}

export function truncateToTwoDecimals(num: number): number {
  return Math.floor(num * 100) / 100;
}

export function formatNumberForMobile(numStr: string): string {
  const num = parseFloat(numStr);
  
  if (isNaN(num)) return "0.00";
  
  // For very small numbers, show in exponential format with first 2 digits
  if (num < 0.01 && num > 0) {
    return num.toExponential(1);
  }
  
  // For larger numbers, truncate to 2 decimal places
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  } else {
    return num.toFixed(2);
  }
}