import { useCallback } from "react";
import { isAddress } from "ethers";
import { safeParseUnits } from "./numberUtils";
import { DECIMAL_PATTERN, DECIMALS, usdstAddress } from "@/lib/constants";
import { useUserTokens } from "@/context/UserTokensContext";

export const toWei = (s: string) => safeParseUnits(s, DECIMALS);
export const fmt = (wei: bigint, sym: string, decimals: number = DECIMALS) => `${(Number(wei) / 10 ** decimals).toFixed(decimals)} ${sym}`;
export const isDecimal = (s: string) => s === "" || s === "." || DECIMAL_PATTERN.test(s);

export const handleRecipientAddress = (e: React.ChangeEvent<HTMLInputElement>, setRecipient: (value: string) => void, setError: (error: string) => void, userAddress: string): void => {
  const v = e.target.value.trim();
  setRecipient(v);
  if (!v) return setError("");
  if (!isAddress(v)) return setError("Invalid address");
  if (v.toLowerCase() === userAddress.toLowerCase()) return setError("You cannot transfer to your own address.");
  setError("");
};

export interface AmountValidationOptions {
  maxAmount: bigint;
  symbol: string;
  tokenAddress: string;
  transactionFee: string;
  voucherBalance: bigint;
  usdstBalance: bigint;
  minAmount?: bigint;
  allowZero?: boolean;
  decimals?: number;
}

export interface AmountValidationResult {
  isValid: boolean;
  error?: string;
  amountWei?: bigint;
}

export const validateAmount = (value: string, o: AmountValidationOptions): AmountValidationResult => {
  const feeWei = toWei(o.transactionFee);

  if (value.trim() === "") return { isValid: true };
  if (!DECIMAL_PATTERN.test(value)) return { isValid: false, error: "Please enter a valid number" };

  // Use provided decimals or default to 18
  const decimals = o.decimals ?? DECIMALS;
  
  // Check if the decimal part is too long
  const decimalPart = value.includes('.') ? value.split('.')[1] : '';
  if (decimalPart.length > decimals) {
    return { isValid: false, error: `Maximum ${decimals} decimal places allowed` };
  }

  // Use safeParseUnits with the correct decimals
  const amt = safeParseUnits(value, decimals);
  if (amt === 0n && !o.allowZero && value !== "0" && value !== "0.") {
    return { isValid: false, error: "Amount must be greater than 0" };
  }
  if (o.minAmount && amt < o.minAmount) return { isValid: false, error: `Amount must be at least ${fmt(o.minAmount, o.symbol, decimals)}` };

  const feeCover = o.usdstBalance + o.voucherBalance;
  if (feeWei > 0n && feeCover < feeWei)
    return { isValid: false, error: `Insufficient USDST + vouchers for transaction fee (${fmt(feeWei, "USDST", DECIMALS)} required)` };

  const maxNet = o.maxAmount; // Always use the raw balance, vouchers only pay fees
  if (amt > maxNet)
    return { isValid: false, error: `Insufficient balance. Maximum: ${fmt(maxNet, o.symbol, decimals)}` };

  return { isValid: true, amountWei: amt };
};

export const handleAmountInputChange = (raw: string, setAmount: (v: string) => void, setError: (e: string) => void, opts: AmountValidationOptions) => {
  const v = raw.replace(/,/g, "");
  if (!isDecimal(v)) { setError("Please enter a valid number"); return; }
  const normalized = v === "." ? "0." : v;
  setAmount(normalized);
  const { error } = validateAmount(normalized, opts);
  setError(error ?? "");
};

export const computeMaxTransferable = (
  maxAmount: bigint,
  tokenAddress: string,
  transactionFee: string,
  voucherBalance: bigint,
  usdstBalance: bigint
): bigint => {
  const feeWei = toWei(transactionFee);
  
  if (tokenAddress === usdstAddress) {
    const totalAvailableForFee = usdstBalance + voucherBalance;
    if (totalAvailableForFee < feeWei) {
      return 0n;
    }
    
    if (voucherBalance >= feeWei) {
      return maxAmount;
    }
    
    const availableForTransfer = usdstBalance - feeWei;
    return availableForTransfer > 0n ? availableForTransfer : 0n;
  }
  
  return maxAmount;
};

export const useAmountValidation = () => {
  const { usdstBalance, voucherBalance } = useUserTokens();
  const vb = BigInt(voucherBalance);
  const ub = BigInt(usdstBalance);

  const validateAmountWithContext = useCallback((v: string, opts: Omit<AmountValidationOptions, "voucherBalance"|"usdstBalance">) =>
    validateAmount(v, { ...opts, voucherBalance: vb, usdstBalance: ub }), [vb, ub]);

  const handleInput = useCallback((v: string, setAmt: (v: string) => void, setErr: (e: string) => void,
    opts: Omit<AmountValidationOptions, "voucherBalance"|"usdstBalance">) =>
      handleAmountInputChange(v, setAmt, setErr, { ...opts, voucherBalance: vb, usdstBalance: ub }),
    [vb, ub]);

  const getMaxTransferable = useCallback((maxAmount: bigint, tokenAddress: string, transactionFee: string) =>
    computeMaxTransferable(maxAmount, tokenAddress, transactionFee, vb, ub), [vb, ub]);

  return { validateAmount: validateAmountWithContext, handleInput, getMaxTransferable };
}; 