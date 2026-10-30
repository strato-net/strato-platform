import type { FeeQuote } from "@strato/shared-types";
import { formatWeiAmount, truncateDecimals } from "@/utils/numberUtils";

export interface FeeCoverage {
  /** Calls paid with a whole voucher each. */
  vouchersUsed: number;
  /** Calls charged in the quote's currency. */
  uncoveredCalls: number;
  /** Total charge in the quote's currency, wei. */
  chargeWei: bigint;
}

/** How `calls` contract calls get paid under the quote: vouchers first, the rest in the fee currency. */
export const feeCoverage = (quote: FeeQuote, calls: number): FeeCoverage => {
  const vouchersUsed = Math.min(calls, Number(quote.vouchers));
  const uncoveredCalls = calls - vouchersUsed;
  return { vouchersUsed, uncoveredCalls, chargeWei: BigInt(quote.feeWei) * BigInt(uncoveredCalls) };
};

const fmt = (wei: bigint, decimals: number) => truncateDecimals(formatWeiAmount(wei.toString()), decimals);

/** "Covered by 1 voucher", "0.0221 STRATO · 0.02 USDST equivalent", "0.02 USDST", or a mix of the two. */
export const describeFee = (quote: FeeQuote, calls: number): string => {
  const { vouchersUsed, uncoveredCalls, chargeWei } = feeCoverage(quote, calls);
  const vouchers = vouchersUsed ? `${vouchersUsed} voucher${vouchersUsed === 1 ? "" : "s"}` : "";
  if (!uncoveredCalls) return `Covered by ${vouchers}`;
  const charge = `${fmt(chargeWei, 4)} ${quote.currency}`;
  const usd = quote.currency === "STRATO"
    ? ` · ${fmt(BigInt(quote.usdFeeWei) * BigInt(uncoveredCalls), 2)} USDST equivalent`
    : "";
  return vouchers ? `${vouchers} + ${charge}${usd}` : `${charge}${usd}`;
};

const normalize = (address: string) => address.toLowerCase().replace(/^0x/, "");

/** True when `tokenAddress` is the quote's fee currency. */
export const isFeeCurrency = (quote: FeeQuote, tokenAddress?: string): boolean =>
  !!tokenAddress && normalize(tokenAddress) === normalize(quote.currencyAddress);

/** True when `tokenAddress` is the USDST that buys what the fee currency cannot cover. */
export const isFallbackCurrency = (quote: FeeQuote, tokenAddress?: string): boolean =>
  !!quote.fallback && !!tokenAddress && normalize(tokenAddress) === normalize(quote.fallback.address);

/** What an action spends by itself of the fee currency and of its USDST fallback, wei. */
export interface FeeSpend {
  currencyWei: bigint;
  fallbackWei: bigint;
}

const NO_SPEND: FeeSpend = { currencyWei: 0n, fallbackWei: 0n };

/** `amountWei` of `tokenAddress` as a fee spend: it counts only when that token pays fees. */
export const feeCurrencySpend = (quote: FeeQuote, tokenAddress: string | undefined, amountWei: bigint): FeeSpend => ({
  currencyWei: isFeeCurrency(quote, tokenAddress) ? amountWei : 0n,
  fallbackWei: isFallbackCurrency(quote, tokenAddress) ? amountWei : 0n,
});

/**
 * USDST the router may spend buying the STRATO that `calls` still need once the action has
 * spent `currencyWei` of the user's STRATO; 0n when the STRATO balance covers them.
 */
export const fallbackCharge = (quote: FeeQuote, calls: number, currencyWei = 0n): bigint => {
  if (!quote.fallback) return 0n;
  const feeWei = BigInt(quote.feeWei);
  const short = feeCoverage(quote, calls).chargeWei + currencyWei - BigInt(quote.balanceWei);
  return short > 0n ? (short * BigInt(quote.fallback.maxWei) + feeWei - 1n) / feeWei : 0n;
};

/** "Not enough STRATO for the fee: up to 0.02 USDST buys the rest", or "" when STRATO covers it. */
export const describeFallback = (quote: FeeQuote, calls: number, currencyWei = 0n): string => {
  const usdst = fallbackCharge(quote, calls, currencyWei);
  return usdst > 0n ? `Not enough ${quote.currency} for the fee: up to ${fmt(usdst, 4)} USDST buys the rest` : "";
};

/**
 * Why `calls` cannot be paid for right now, or "" when they can. `spend` is what the action
 * itself spends of the tokens that pay fees, which must still leave the fee.
 */
export const feeShortfall = (quote: FeeQuote, calls: number, spend = NO_SPEND): string => {
  const { uncoveredCalls, chargeWei } = feeCoverage(quote, calls);
  if (!uncoveredCalls) return "";
  if (!quote.valid) return "Network fee price unavailable: only vouchers can pay right now";
  if (chargeWei + spend.currencyWei <= BigInt(quote.balanceWei)) return "";
  // USDST buys only the fee: what the action itself spends must already be there.
  if (spend.currencyWei > BigInt(quote.balanceWei)) return `Insufficient ${quote.currency}`;
  if (!quote.fallback) return `Insufficient ${quote.currency} for the network fee`;
  if (fallbackCharge(quote, calls, spend.currencyWei) + spend.fallbackWei > BigInt(quote.fallback.balanceWei)) {
    return `Insufficient ${quote.currency} and USDST for the network fee`;
  }
  return "";
};

/** Ten calls' worth: the balance below which the app warns that fees will soon be unpayable. */
const LOW_BALANCE_CALLS = 10n;

/**
 * True when, after `calls` are paid and `spend.currencyWei` of the fee currency is spent by the
 * action itself, the fee currency left covers fewer than ten more calls.
 */
export const feeBalanceLow = (quote: FeeQuote, calls: number, spend = NO_SPEND): boolean => {
  const { chargeWei } = feeCoverage(quote, calls);
  const remaining = BigInt(quote.balanceWei) - spend.currencyWei - chargeWei;
  return remaining >= 0n && remaining <= BigInt(quote.feeWei) * LOW_BALANCE_CALLS;
};
