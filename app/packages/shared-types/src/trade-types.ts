// ============================================================================
// UNIFIED TRADE TYPES
// One normalized shape for quoting and executing swaps across all three pool
// contract types: V2 constant-product Pool, Curve-style StablePool (2-coin and
// multi-token), and Uniswap-V3-style PoolV3.
// ============================================================================

export type TradePoolType = "v2" | "stable" | "v3";

/** One side of a pool, oriented to the requested trading pair */
export interface TradePoolSide {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** pool's balance of this token, wei string — feeds pool-balance display and To-side caps */
  poolBalance: string;
}

/** Normalized pool metadata for a trading pair, across all pool types */
export interface TradePool {
  address: string;
  poolType: TradePoolType;
  /** display label, e.g. "V2" | "Stable" | "V3 0.3%" */
  poolLabel: string;
  /** normalized fee in basis points (v2 bps as-is; stable fee/1e6; v3 pips/100) */
  feeBps: number;
  /** side matching the requested tokenIn (the "from" side) */
  tokenIn: TradePoolSide;
  tokenOut: TradePoolSide;
  /** fee-less marginal rate, tokenOut per tokenIn, 1e18 fixed point */
  spotRateWad: string;
  /** oracle-implied rate for the pair where oracle prices exist, 1e18 */
  oracleRateWad?: string;
  totalLiquidityUSD: number;
  isPaused: boolean;
  isDisabled: boolean;
}

/** Exact quote for one pool, computed server-side with the contract's own math */
export interface TradeQuote {
  poolAddress: string;
  poolType: TradePoolType;
  poolLabel: string;
  tokenIn: string;
  tokenOut: string;
  exactOut: boolean;
  /** input consumed, wei string (exact-out: computed gross input) */
  amountIn: string;
  /** output produced after fees, wei string */
  amountOut: string;
  /** fee withheld, wei string (input token for v2/v3; output token for stable) */
  feeAmount: string;
  feeBps: number;
  /** percent, execution rate vs fee-less spot rate */
  priceImpact: number;
  /** fee-less marginal rate at quote time, tokenOut per tokenIn, 1e18 */
  spotRateWad?: string;
  /** v3 exact-out only: pool could not fill the full requested amount */
  partialFill?: boolean;
  poolTvlUsd: number;
  /** set when this pool could not be quoted (no liquidity, rebasing pool, …);
   *  amounts are zeroed and the pool is excluded from best-pool selection */
  error?: string;
}

export interface TradeQuoteResponse {
  tokenIn: string;
  tokenOut: string;
  /** the requested amount, positive wei string */
  amount: string;
  type: "EXACT_INPUT" | "EXACT_OUTPUT";
  quotes: TradeQuote[];
  /** best executable quote: max amountOut (exact-in) / min amountIn (exact-out)
   *  among error-free, non-partial (exact-out), active pools; null when none */
  bestPoolAddress: string | null;
}

/** Parameters for executing a swap on any pool type via POST /trade/swap */
export interface TradeSwapParams {
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
}
