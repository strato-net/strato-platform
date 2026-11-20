import { WAD } from '../lib/constants.ts';
import { formatWeiToDecimalHP, safeParseUnits } from './numberUtils.ts';

// Amounts are raw token units and rates are STRATO per rewards token scaled by 1e18,
// as the converter holds them. Everything rounds down, like the contract.

/** STRATO paid for `amount` rewards tokens at `rate`: amount × rate ÷ 1e18. */
export const payoutFor = (amount: bigint, rate: bigint): bigint => (amount * rate) / WAD;

/** The MAX amount: the smaller of the balance and max convertible. */
export const maxConvertAmount = (balance: bigint, maxConvertible: bigint): bigint =>
  balance < maxConvertible ? balance : maxConvertible;

/**
 * A decimal rate ("0.3333") as the 18-decimal integer, read only when that is exact: a value with a digit
 * past 18 places, a comma or anything else that is not a plain decimal is 0.
 */
export const rateFromDecimal = (value: string): bigint => safeParseUnits(value, 18);

/** The full decimal value of a rate, without trailing zeros ("0.333333333333333333"). */
export const rateToDecimal = (rate: bigint): string => formatWeiToDecimalHP(rate.toString(), 18);

/**
 * A value at `decimals` decimals in short form, rounded down. From 1 up it has `places` decimals ("40.00").
 * Below 1 it runs to its first non-zero decimal and at most 3 digits after it, to `places` decimals at least
 * ("0.50", "0.001234"), and dots stand in for 4 or more zeros before that decimal ("0.0...1234").
 */
const shortDecimal = (value: bigint, places: number, decimals = 18): string => {
  const unit = 10n ** BigInt(decimals);
  const fraction = (value % unit).toString().padStart(decimals, '0');
  const zeros = fraction.search(/[1-9]/);
  if (value >= unit || zeros < 0) return `${value / unit}.${fraction.slice(0, places)}`;
  const digits = fraction.slice(zeros, zeros + 4).replace(/0+$/, '');
  return zeros < 4 ? `0.${`${fraction.slice(0, zeros)}${digits}`.padEnd(places, '0')}` : `0.0...${digits}`;
};

/** A rate in short form, 4 decimals at least ("0.3333", "0.0...7"). */
export const formatRate = (rate: bigint): string => shortDecimal(rate, 4);

/** A raw token amount below one whole token in short form, 2 decimals at least ("0.50", "0.0...42"). */
export const formatFraction = (raw: bigint, decimals: number): string => shortDecimal(raw, 2, decimals);

// `part` of `whole` as a percentage scaled by 1e18, rounded down
const shareOf = (part: bigint, whole: bigint): bigint => (part * 100n * WAD) / whole;

/** `part` of `whole` as a percentage to all 18 decimals, without trailing zeros; "—" when `whole` is zero. */
export const shareToDecimal = (part: bigint, whole: bigint): string =>
  whole === 0n ? '—' : `${formatWeiToDecimalHP(shareOf(part, whole).toString(), 18)}%`;

/** `part` of `whole` as a percentage in short form, 2 decimals at least ("40.00%"); "—" when `whole` is zero. */
export const formatShare = (part: bigint, whole: bigint): string =>
  whole === 0n ? '—' : `${shortDecimal(shareOf(part, whole), 2)}%`;

/**
 * A raw amount as a decimal cut to its relevant digits: the whole part, then the decimals up to the first
 * non-zero one and at most 4 digits after it, without trailing zeros ("0.00012345", "1.5", "400").
 */
export const formatRelevant = (raw: bigint, decimals: number): string => {
  const unit = 10n ** BigInt(decimals);
  const fraction = (raw % unit).toString().padStart(decimals, '0');
  const kept = fraction.slice(0, fraction.search(/[1-9]/) + 5).replace(/0+$/, '');
  return `${(raw / unit).toLocaleString()}${kept && `.${kept}`}`;
};

const divideUp = (value: bigint, by: bigint): bigint => (value + by - 1n) / by;

/**
 * STRATO to add so max convertible reaches `coverage` (a percentage scaled by 1e18) of `supply` at `rate`:
 * the least that does, and zero when the reserve already does.
 */
export const fundingForCoverage = (coverage: bigint, supply: bigint, rate: bigint, reserve: bigint): bigint => {
  // Max convertible rounds down, so both steps round up:
  // the rewards tokens to cover, then the reserve that pays for them
  const covered = divideUp(supply * coverage, 100n * WAD);
  const target = divideUp(covered * rate, WAD);
  return target > reserve ? target - reserve : 0n;
};
