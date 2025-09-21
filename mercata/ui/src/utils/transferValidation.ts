import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { isAddress } from "ethers";

import {
  DECIMAL,
  DECIMAL_PATTERN,
} from "@/lib/constants";
import {
  safeParseUnits,
  toWei,
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
  tokenBalance: string,
  isUsdToken: boolean,
  userVoucherBalance: string, // already in USDST-wei
  userUsdstBalance: string,   // USDST-wei
  gasFee: string,             // USDST-wei
  setError: Dispatch<SetStateAction<string>>
): string => {
  const token = toWei(tokenBalance);
  if (token <= 0n) return "0";

  const fee = toWei(gasFee);
  const usdst = toWei(userUsdstBalance);
  const vouchers = toWei(userVoucherBalance);

  // Require enough combined USDST + vouchers to cover fee
  if (fee > 0n && usdst + vouchers < fee) {
    setError("Insufficient USDST + voucher balance for transaction fee");
    return "0";
  }
  setError("");

  if (!isUsdToken || fee === 0n) return token.toString();

  // USDST pays only the part of the fee not already covered by vouchers
  const usdPortion = fee > vouchers ? fee - vouchers : 0n;
  const net = token - usdPortion;

  return net > 0n ? net.toString() : "0";
};

export const handleAmountInputChange = (
  userInput: string,
  setAmount: Dispatch<SetStateAction<string>>,
  setError: Dispatch<SetStateAction<string>>,
  maxBalanceWei: string,
  tokenDecimals: number = DECIMAL
): void => {
  const input = userInput.replace(/,/g, "").trim();
  if (!DECIMAL_PATTERN.test(input)) return;

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

  const amountWei = safeParseUnits(input, tokenDecimals);
  if (amountWei <= 0n) return setError("Amount must be greater than 0");

  const maxWei = BigInt(maxBalanceWei || "0");
  if (maxWei <= 0n || amountWei > maxWei) return setError("Insufficient balance");

  setError("");
};
