/**
 * Client-side helpers for the V3 liquidity UI. Display-precision only: exact
 * integer amounts always come from the backend (/poolv3/amounts-for-liquidity,
 * /poolv3/quote), which mirrors the on-chain math bit-for-bit.
 */

export const V3_MIN_TICK = -887272;
export const V3_MAX_TICK = 887272;

/** token1-per-token0 price for a tick (display precision) */
export const tickToPrice = (tick: number): number => Math.pow(1.0001, tick);

/** greatest tick whose price is <= the given token1-per-token0 price (display precision) */
export const priceToTick = (price: number): number => {
  if (!isFinite(price) || price <= 0) return 0;
  return Math.floor(Math.log(price) / Math.log(1.0001));
};

/** snap a tick to the pool's tick spacing, clamped to the usable domain */
export const snapTick = (tick: number, tickSpacing: number): number => {
  const snapped = Math.round(tick / tickSpacing) * tickSpacing;
  const maxUsable = Math.floor(V3_MAX_TICK / tickSpacing) * tickSpacing;
  const minUsable = -maxUsable;
  return Math.min(Math.max(snapped, minUsable), maxUsable);
};

export const fullRangeTicks = (tickSpacing: number): { tickLower: number; tickUpper: number } => {
  const maxUsable = Math.floor(V3_MAX_TICK / tickSpacing) * tickSpacing;
  return { tickLower: -maxUsable, tickUpper: maxUsable };
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
