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

/** How much of the fee currency an action spends by itself: `amountWei` when it spends that token. */
export const feeCurrencySpend = (quote: FeeQuote, tokenAddress: string | undefined, amountWei: bigint): bigint =>
  isFeeCurrency(quote, tokenAddress) ? amountWei : 0n;

/**
 * Why `calls` cannot be paid for right now, or "" when they can. `spendingWei` is what the
 * action itself spends of the fee currency, which must still leave the fee.
 */
export const feeShortfall = (quote: FeeQuote, calls: number, spendingWei = 0n): string => {
  const { uncoveredCalls, chargeWei } = feeCoverage(quote, calls);
  if (!uncoveredCalls) return "";
  if (!quote.valid) return "Network fee price unavailable: only vouchers can pay right now";
  if (chargeWei + spendingWei > BigInt(quote.balanceWei)) return `Insufficient ${quote.currency} for the network fee`;
  return "";
};

/** Ten calls' worth: the balance below which the app warns that fees will soon be unpayable. */
const LOW_BALANCE_CALLS = 10n;

/**
 * True when, after `calls` are paid and `spendingWei` of the fee currency is spent by the
 * action itself, the fee currency left covers fewer than ten more calls.
 */
export const feeBalanceLow = (quote: FeeQuote, calls: number, spendingWei = 0n): boolean => {
  const { chargeWei } = feeCoverage(quote, calls);
  const remaining = BigInt(quote.balanceWei) - spendingWei - chargeWei;
  return remaining >= 0n && remaining <= BigInt(quote.feeWei) * LOW_BALANCE_CALLS;
};
