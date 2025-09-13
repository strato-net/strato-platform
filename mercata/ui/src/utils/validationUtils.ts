import { isAddress } from "ethers";
import { safeParseUnits } from "./numberUtils";
import { DECIMAL_PATTERN, DECIMALS, usdstAddress } from "@/lib/constants";

export const toWei = (s: string) => safeParseUnits(s, DECIMALS);
export const fmt = (wei: bigint, sym: string, decimals: number = DECIMALS) => {
  // Use precise formatting to avoid floating-point issues
  const divisor = BigInt(10 ** decimals);
  const wholePart = wei / divisor;
  const fractionalPart = wei % divisor;
  
  if (fractionalPart === 0n) {
    return `${wholePart.toString()}.${'0'.repeat(decimals)} ${sym}`;
  }
  
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  // Remove trailing zeros
  const trimmedFractional = fractionalStr.replace(/0+$/, '');
  
  return `${wholePart.toString()}.${trimmedFractional} ${sym}`;
};
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
  tokenAddress: string | null, 
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
    
    // If vouchers can cover the full fee, user can deposit their entire USDST balance
    if (voucherBalance >= feeWei) {
      return maxAmount;
    }

    // If vouchers don't cover the full fee, user needs to reserve some USDST for the fee
    // The amount they can deposit = total USDST - (fee - vouchers)
    const usdstNeededForFee = feeWei - voucherBalance;
    const availableForDeposit = usdstBalance - usdstNeededForFee;
    return availableForDeposit > 0n ? availableForDeposit : 0n;
  }
  
  return maxAmount;
};
