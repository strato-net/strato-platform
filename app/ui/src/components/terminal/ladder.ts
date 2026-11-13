import type { Market, PoolV3LiquidityDistribution } from "@/interface";

// ============================================================================
// DEPTH LADDER MATH
// A V3 pool has no resting orders: what a CEX shows as an order book is here the
// pool's liquidity, re-read as "how much trades between two prices". Within a tick
// interval of constant liquidity L, moving the sqrt price from a to b (a < b)
// exchanges token0 = L·(b−a)/(a·b) for token1 = L·(b−a) (Uniswap V3 whitepaper 6.29/6.30).
// ============================================================================

export interface LadderLevel {
  /** the far edge of the level: the pool price once the level is fully consumed */
  price: number;
  /** base tokens that trade across the level */
  base: number;
  /** quote tokens that trade across the level */
  quote: number;
  /** cumulative quote from the pool price out to this level */
  totalQuote: number;
}

export interface Ladder {
  /** pool price, quote per base */
  price: number;
  /** nearest the pool price first */
  asks: LadderLevel[];
  bids: LadderLevel[];
}

type MarketShape = Pick<Market, "baseIsToken0"> & {
  base: Pick<Market["base"], "decimals">;
  quote: Pick<Market["quote"], "decimals">;
};

const sqrtRatioAtTick = (tick: number): number => Math.pow(1.0001, tick / 2);

/** Pool price as quote per base in whole-token units: the pool ratio (or its inverse) × scale */
export const poolPrice = (distribution: PoolV3LiquidityDistribution, market: MarketShape): number => {
  const sqrtPool = Number(BigInt(distribution.sqrtPriceX96)) / 2 ** 96;
  const ratio = sqrtPool * sqrtPool;
  return (market.baseIsToken0 ? ratio : 1 / ratio) * 10 ** (market.base.decimals - market.quote.decimals);
};

export function buildLadder(
  distribution: PoolV3LiquidityDistribution,
  market: MarketShape,
  grouping: number,
  levelCount: number
): Ladder {
  const { baseIsToken0 } = market;
  const scale = 10 ** (market.base.decimals - market.quote.decimals);
  const price = poolPrice(distribution, market);
  const toSqrtPool = (marketPrice: number): number =>
    Math.sqrt(baseIsToken0 ? marketPrice / scale : scale / marketPrice);

  const segments = distribution.segments.map((s) => ({
    lower: sqrtRatioAtTick(s.tickLower),
    upper: sqrtRatioAtTick(s.tickUpper),
    liquidity: Number(s.liquidity),
  }));

  /** tokens that trade while the market price moves between two prices */
  const amountsBetween = (priceA: number, priceB: number): { base: number; quote: number } => {
    const [lo, hi] = [toSqrtPool(priceA), toSqrtPool(priceB)].sort((x, y) => x - y);
    let token0 = 0;
    let token1 = 0;
    for (const s of segments) {
      const a = Math.max(lo, s.lower);
      const b = Math.min(hi, s.upper);
      if (a >= b) continue;
      token0 += (s.liquidity * (b - a)) / (a * b);
      token1 += s.liquidity * (b - a);
    }
    const [base, quote] = baseIsToken0 ? [token0, token1] : [token1, token0];
    return { base: base / 10 ** market.base.decimals, quote: quote / 10 ** market.quote.decimals };
  };

  const side = (direction: 1 | -1): LadderLevel[] => {
    const levels: LadderLevel[] = [];
    const first = direction === 1 ? Math.floor(price / grouping) + 1 : Math.ceil(price / grouping) - 1;
    let previous = price;
    let totalQuote = 0;
    for (let k = 0; k < levelCount; k++) {
      const edge = (first + direction * k) * grouping;
      if (edge <= 0) break;
      const { base, quote } = amountsBetween(previous, edge);
      totalQuote += quote;
      levels.push({ price: edge, base, quote, totalQuote });
      previous = edge;
    }
    return levels;
  };

  return { price, asks: side(1), bids: side(-1) };
}

/** Three price groupings scaled to the price: 1, 5 and 10 hundredths of its magnitude */
export const groupingOptions = (price: number): number[] => {
  if (!(price > 0)) return [0.01, 0.05, 0.1];
  const step = 10 ** (Math.floor(Math.log10(price)) - 2);
  return [step, step * 5, step * 10];
};

/** Decimals needed to print a price at the given grouping */
export const groupingDecimals = (grouping: number): number => Math.max(0, -Math.floor(Math.log10(grouping)));
