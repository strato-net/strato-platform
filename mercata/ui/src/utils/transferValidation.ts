import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { isAddress } from "ethers";

import {
  DECIMAL,
} from "@/lib/constants";
import {
  safeParseUnits,
} from "@/utils/numberUtils";


export const validateRecipientAddress = (
  value: string,
  userAddress?: string
): string => {
  const addr = value.trim();
  if (!addr) return "";
  if (!isAddress(addr)) return "Invalid address";
  if (userAddress && addr.toLowerCase() === userAddress.toLowerCase()) {
    return "You cannot transfer to your own address.";
  }
  return "";
};

export const handleRecipientAddress = (
  e: ChangeEvent<HTMLInputElement>,
  setRecipient: Dispatch<SetStateAction<string>>,
  setRecipientError: Dispatch<SetStateAction<string>>,
  userAddress?: string
): void => {
  const val = e.target.value.trim();
  setRecipient(val);
  setRecipientError(validateRecipientAddress(val, userAddress));
};

export const computeMaxTransferable = (
  tokenBalanceWei: string,           // wei
  isUsdToken: boolean,
  userVoucherBalanceWei: string,     // wei
  userUsdstBalanceWei: string,       // wei
  gasFeeWei: string,                 // wei
  setError: Dispatch<SetStateAction<string>>
): string => {
  const token = BigInt(tokenBalanceWei || "0");
  if (token <= 0n) return "0";

  const fee = BigInt(gasFeeWei || "0");
  const usdst = BigInt(userUsdstBalanceWei || "0");
  const vouchers = BigInt(userVoucherBalanceWei || "0");

  // Enough means >=, not >
  if (fee > 0n && (usdst + vouchers) < fee) {
    setError("Insufficient USDST + voucher balance for transaction fee");
    return token.toString();
  }
  setError("");

  if (!isUsdToken || fee === 0n) return token.toString();

  const usdPortion = fee > vouchers ? fee - vouchers : 0n;
  const net = token - usdPortion;
  return net > 0n ? net.toString() : "0";
};

export const handleAmountInputChange = (
  userInput: string,
  setAmount: Dispatch<SetStateAction<string>>,
  setError: Dispatch<SetStateAction<string>>,
  maxBalanceWei: string | undefined,
  tokenDecimals: number = DECIMAL
): void => {
  const input = userInput.replace(/,/g, "").trim();
  
  // Check for valid number format first (most basic validation)
  const basicPattern = /^\d*\.?\d*$/;
  if (!basicPattern.test(input)) {
    setError("Invalid input format");
    return;
  }

  // Always set the amount after basic format validation
  if (!input) {
    setAmount("");
    setError("");
    return;
  }

  if (input === ".") {
    setAmount("0.");
    setError("");
    return;
  }

  setAmount(input);
  
  // Check decimal places separately
  if (input.includes('.')) {
    const decimalPart = input.split('.')[1];
    if (decimalPart && decimalPart.length > tokenDecimals) {
      setError(`Maximum ${tokenDecimals} decimal places allowed`);
      return;
    }
  }

  const amountWei = safeParseUnits(input, tokenDecimals);
  if (amountWei <= 0n) return setError("Amount must be greater than 0");

  // Only check max balance if provided
  if (maxBalanceWei !== undefined) {
    const maxWei = BigInt(maxBalanceWei || "0");
    if (maxWei <= 0n || amountWei > maxWei) return setError("Maximum amount exceeded");
  }

  setError("");
};

export const handleAdminNumericInputChange = (
  userInput: string,
  setValue: (value: string) => void,
  setError: (error: string) => void,
  maxValue: string = "999999999999999999999999999",
  decimals: number = 18,
  minValue: string = "0"
): void => {
  const input = userInput.replace(/,/g, "").trim();
  
  // Check for valid number format first
  // For integer-only inputs (decimals = 0), don't allow decimal points
  const basicPattern = decimals === 0 ? /^\d*$/ : /^\d*\.?\d*$/;
  if (!basicPattern.test(input)) {
    setError(decimals === 0 ? "Only whole numbers allowed" : "Invalid input format");
    return;
  }

  // Always set the value after basic format validation
  if (!input) {
    setValue("");
    setError("");
    return;
  }

  if (input === ".") {
    setValue("0.");
    setError("");
    return;
  }

  setValue(input);
  
  // Check decimal places
  if (input.includes('.')) {
    const decimalPart = input.split('.')[1];
    if (decimalPart && decimalPart.length > decimals) {
      setError(`Maximum ${decimals} decimal places allowed`);
      return;
    }
  }

  // Check min and max values (no balance check needed for admin forms)
  const numValue = parseFloat(input);
  const maxNum = parseFloat(maxValue);
  const minNum = parseFloat(minValue);
  
  if (numValue > maxNum) {
    setError(`Value cannot exceed ${maxValue}`);
    return;
  }
  
  if (numValue < minNum) {
    setError(`Value must be at least ${minValue}`);
    return;
  }

  setError("");
};
