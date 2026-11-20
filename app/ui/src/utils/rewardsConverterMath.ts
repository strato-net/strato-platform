import { WAD } from '../lib/constants.ts';
import { formatWeiToDecimalHP, parseUnitsWithTruncation } from './numberUtils.ts';

// Amounts are raw token units and rates are STRATO per rewards token scaled by 1e18,
// as the converter holds them. Everything rounds down, like the contract.

/** STRATO paid for `amount` rewards tokens at `rate`: amount × rate ÷ 1e18. */
export const payoutFor = (amount: bigint, rate: bigint): bigint => (amount * rate) / WAD;

/** The MAX amount: the smaller of the balance and max convertible. */
export const maxConvertAmount = (balance: bigint, maxConvertible: bigint): bigint =>
  balance < maxConvertible ? balance : maxConvertible;

/** A decimal rate ("0.3333") as the 18-decimal integer; digits past 18 places are dropped, invalid input is 0. */
export const rateFromDecimal = (value: string): bigint => parseUnitsWithTruncation(value, 18);

/** The full decimal value of a rate, without trailing zeros ("0.333333333333333333"). */
export const rateToDecimal = (rate: bigint): string => formatWeiToDecimalHP(rate.toString(), 18);

/** A rate to 4 decimals ("0.3333"). */
export const formatRate = (rate: bigint): string => {
  const scaled = rate / 10n ** 14n;
  return `${scaled / 10000n}.${(scaled % 10000n).toString().padStart(4, '0')}`;
};

/** `part` of `whole` as a percentage to 2 decimals ("40.00%"), rounded down; "—" when `whole` is zero. */
export const formatShare = (part: bigint, whole: bigint): string => {
  if (whole === 0n) return '—';
  const hundredths = (part * 10000n) / whole;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}%`;
};

/**
 * STRATO to add so the reserve pays for `coverage` (a percentage scaled by 1e18) of `supply` at `rate`,
 * rounded up so the coverage is reached; zero when the reserve already does.
 */
export const fundingForCoverage = (coverage: bigint, supply: bigint, rate: bigint, reserve: bigint): bigint => {
  const scale = WAD * 100n * WAD;
  const target = (supply * rate * coverage + scale - 1n) / scale;
  return target > reserve ? target - reserve : 0n;
};
