/**
 * Client-side helpers for the V3 liquidity UI. Display-precision only: exact
 * integer amounts always come from the backend (/poolv3/amounts-for-liquidity,
 * /trade/quote), which mirrors the on-chain math bit-for-bit.
 */
import { formatUnits } from "ethers";

export const V3_MIN_TICK = -887272;
export const V3_MAX_TICK = 887272;

/**
 * Format a token amount (wei string/bigint) for display.
 *
 * Rounds (so liquidity-quantization dust such as 99.99999999e18 renders as "100.00", not
 * the truncated "99.999999"), always shows at least 2 fraction digits so exact amounts read
 * "1.00" / "100.00" (users can tell there is no hidden precision), keeps the whole integer
 * part intact, keeps sub-1 values precise to `sigDigits` significant figures (0.0001235),
 * shows a "<…" marker for values below display resolution, and locale-groups thousands.
 *
 * DISPLAY ONLY — never feed this back into a transaction; the exact integer wei from the
 * backend is what gets signed.
 */
export const formatTokenAmount = (
  amountWei: string | bigint,
  decimals = 18,
  sigDigits = 4
): string => {
  let wei: bigint;
  try {
    wei = typeof amountWei === "bigint" ? amountWei : BigInt(amountWei ?? "0");
  } catch {
    return "0";
  }
  if (wei === 0n) return "0";

  // float64 carries ~15-16 significant digits — ample for rounding to `sigDigits` for display
  const value = Number(formatUnits(wei, decimals));
  if (!isFinite(value) || value === 0) return "0";

  const abs = Math.abs(value);
  const minShownDecimals = sigDigits + 2;
  const minShown = Math.pow(10, -minShownDecimals); // e.g. 4 sig -> 0.000001
  if (abs < minShown) return `<${minShown.toFixed(minShownDecimals)}`;

  // Always show at least 2 fraction digits so exact values read "1.00" (signalling no hidden
  // precision), and up to `sigDigits` significant digits of extra precision for finer amounts.
  // Expressed purely via fraction-digit bounds: this rounds (dust -> "100.00"), never truncates,
  // and avoids relying on Intl combining significant + fraction options (not portable).
  let maxFractionDigits: number;
  if (abs >= 1) {
    // Keep the whole integer part; the extra precision budget goes to the fraction.
    const intDigits = Math.floor(Math.log10(abs)) + 1;
    maxFractionDigits = Math.max(2, sigDigits - intDigits);
  } else {
    // Sub-1: keep `sigDigits` significant figures (0.12, 0.0001235), floored at 2 decimals.
    const leadingZeros = -Math.floor(Math.log10(abs)) - 1;
    maxFractionDigits = leadingZeros + sigDigits;
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
};

/** token1-per-token0 price for a tick (display precision) */
export const tickToPrice = (tick: number): number => Math.pow(1.0001, tick);

/** greatest tick whose price is <= the given token1-per-token0 price (display precision) */
export const priceToTick = (price: number): number => {
  if (!isFinite(price) || price <= 0) return 0;
  return Math.floor(Math.log(price) / Math.log(1.0001));
};

/**
 * 'max' | 'min' when the pool's price is pinned at the tick-domain edge, else null.
 * A swap that drains one side of the pool walks the price to the edge (~2^±128 —
 * e.g. "3.4e+38"), which is a market-emptiness marker, not a price. At >= maxUsable
 * the price sits above every possible position's upper bound (in-range requires
 * currentTick < tickUpper <= maxUsable), so no liquidity can be in range.
 */
export const priceDomainEdge = (pool: { currentTick: number; tickSpacing: number }): "max" | "min" | null => {
  const maxUsable = Math.floor(V3_MAX_TICK / pool.tickSpacing) * pool.tickSpacing;
  if (pool.currentTick >= maxUsable) return "max";
  if (pool.currentTick < -maxUsable) return "min";
  return null;
};

/** snap a tick to the pool's tick spacing, clamped to the usable domain */
export const snapTick = (tick: number, tickSpacing: number): number => {
  const snapped = Math.round(tick / tickSpacing) * tickSpacing;
  const maxUsable = Math.floor(V3_MAX_TICK / tickSpacing) * tickSpacing;
  const minUsable = -maxUsable;
  return Math.min(Math.max(snapped, minUsable), maxUsable);
};

/**
 * Token amounts returned by a V3 action. Every action's return tuple ENDS with
 * (amount0, amount1) but the leading values differ — pool burn/collect and manager
 * decreaseLiquidity/collect return exactly (amount0, amount1), while
 * PositionManagerV3.mint returns (tokenId, liquidity, amount0, amount1) and
 * increaseLiquidity (liquidity, amount0, amount1) — so read the last TWO values of the
 * LAST transaction's decoded returns (the action tx is always last in its batch, after
 * approvals or the fee-realizing poke, in both the OAuth and wallet signing flows).
 * Returns null when unavailable (older backend, pending tx, unexpected shape).
 */
export const poolV3TxAmounts = (res: unknown): { amount0: bigint; amount1: bigint } | null => {
  const rv = (res as { returnValues?: unknown } | null)?.returnValues;
  if (!Array.isArray(rv) || rv.length === 0) return null;
  const last = rv[rv.length - 1];
  if (!Array.isArray(last) || last.length < 2) return null;
  try {
    return {
      amount0: BigInt(String(last[last.length - 2])),
      amount1: BigInt(String(last[last.length - 1])),
    };
  } catch {
    return null;
  }
};

/** "1.23 GOLD + 4.56 USDST" for a pool action's returned amounts; null when both are zero */
export const describePoolAmounts = (
  pool: { token0: { symbol: string; decimals: number }; token1: { symbol: string; decimals: number } },
  amounts: { amount0: bigint; amount1: bigint }
): string | null => {
  const parts: string[] = [];
  if (amounts.amount0 > 0n) parts.push(`${formatTokenAmount(amounts.amount0, pool.token0.decimals)} ${pool.token0.symbol}`);
  if (amounts.amount1 > 0n) parts.push(`${formatTokenAmount(amounts.amount1, pool.token1.decimals)} ${pool.token1.symbol}`);
  return parts.length ? parts.join(" + ") : null;
};

/** human price from an 18-decimal wei string, with sensible precision for wide ranges */
export const formatPriceWad = (priceWad: string): string => {
  const value = Number(BigInt(priceWad)) / 1e18;
  if (!isFinite(value) || value === 0) return "0";
  if (value >= 1e15) return value.toExponential(4);
  if (value < 1e-9) return value.toExponential(4);
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value.toLocaleString(undefined, { maximumSignificantDigits: 6 });
};

export const formatTickAsPrice = (tick: number): string => {
  const price = tickToPrice(tick);
  if (price >= 1e15 || (price > 0 && price < 1e-9)) return price.toExponential(4);
  if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return price.toLocaleString(undefined, { maximumSignificantDigits: 6 });
};

/**
 * tick -> price as a plain machine-parseable string (dot decimal, no locale grouping).
 * For prefilling editable inputs that get parsed back — formatTickAsPrice's locale
 * grouping ("1,952.33") would reparse as 1.
 */
export const tickToPriceInput = (tick: number): string => {
  const price = tickToPrice(tick);
  if (!isFinite(price) || price <= 0) return "0";
  return String(Number(price.toPrecision(6)));
};
