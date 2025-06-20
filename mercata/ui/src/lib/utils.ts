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