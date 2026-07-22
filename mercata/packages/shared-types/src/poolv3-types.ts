// ============================================================================
// POOL V3 (CONCENTRATED LIQUIDITY) TYPES
// ============================================================================

export interface PoolV3Token {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  image?: string;
}

export interface PoolV3 {
  address: string;
  token0: PoolV3Token;
  token1: PoolV3Token;
  /** fee in pips (hundredths of a bip, 1e6 denominator; e.g. 3000 = 0.30%) */
  fee: number;
  tickSpacing: number;
  /** current sqrt(token1/token0 price), Q64.96, as decimal string */
  sqrtPriceX96: string;
  currentTick: number;
  /** in-range liquidity, decimal string */
  liquidity: string;
  /** token1 per token0 price, 18-decimal wei string */
  priceWad: string;
  /** oracle spot price, token1 per token0, 18-decimal wei string ("0" when either token has no oracle price) */
  oraclePriceWad: string;
  token0Balance: string;
  token1Balance: string;
  /** protocol fee denominators, canonical packed form feeProtocol0 + (feeProtocol1 << 4); 0 = off */
  feeProtocol: number;
  /** accrued protocol fees awaiting collectProtocol, wei strings */
  protocolFees0: string;
  protocolFees1: string;
  totalLiquidityUSD: number;
  /** 24h trading volume in USD (input side of each swap, valued at oracle prices) */
  volume24hUSD: number;
  /** annualized LP fee yield in percent, from the last 24h of fees vs TVL */
  apy: number;
  isPaused: boolean;
  isDisabled: boolean;
  poolName: string;
}

export interface PoolV3Quote {
  poolAddress: string;
  zeroForOne: boolean;
  exactOut: boolean;
  /** input consumed (incl. fee), wei string */
  amountIn: string;
  /** output produced, wei string */
  amountOut: string;
  /** fee paid in the input token, wei string */
  feeAmount: string;
  /** pool fee tier in pips */
  fee: number;
  sqrtPriceX96After: string;
  tickAfter: number;
  /** price impact in percent (spot vs execution price) */
  priceImpact: number;
  /** true when the pool could not fill the full requested amount */
  partialFill: boolean;
}

export interface PoolV3Position {
  poolAddress: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  /** position liquidity, decimal string */
  liquidity: string;
  /** current withdrawable principal at spot, wei strings */
  amount0: string;
  amount1: string;
  /** already-owed (burned principal + collected-pending fees), wei strings */
  tokensOwed0: string;
  tokensOwed1: string;
  /** fees earned since the position's last on-chain touch — not yet in tokensOwed;
   *  realized automatically by the poke that collect/burn perform, wei strings */
  pendingFees0: string;
  pendingFees1: string;
  /** whether the current pool tick is inside [tickLower, tickUpper) */
  inRange: boolean;
  /** price bounds as 18-decimal token1-per-token0 wei strings */
  priceLowerWad: string;
  priceUpperWad: string;
}

export interface PoolV3AmountsPreview {
  amount0: string;
  amount1: string;
  liquidity: string;
  tickLower: number;
  tickUpper: number;
}

// ---- request payloads ----

export interface PoolV3SwapParams {
  poolAddress: string;
  zeroForOne: boolean;
  /** positive = exact input, negative = exact output (wei string) */
  amountSpecified: string;
  /** exact input: min output; exact output: max input (wei string) */
  amountLimit: string;
  sqrtPriceLimitX96?: string;
}

export interface PoolV3MintParams {
  poolAddress: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0Max: string;
  amount1Max: string;
}

export interface PoolV3BurnParams {
  poolAddress: string;
  tickLower: number;
  tickUpper: number;
  /** liquidity to remove; "0" is a poke (reverts on empty positions) */
  liquidity: string;
  /** also collect all owed tokens after the burn */
  collect?: boolean;
}

export interface PoolV3CollectParams {
  poolAddress: string;
  tickLower: number;
  tickUpper: number;
  amount0Requested?: string;
  amount1Requested?: string;
}

export interface PoolV3CreateParams {
  tokenA: string;
  tokenB: string;
  fee: number;
  /** initial sqrt price, Q64.96 decimal string. Provide this OR `price`. */
  initialSqrtPriceX96?: string;
  /** human-readable initial price, token1(tokenB) per token0(tokenA), e.g. "2000".
   *  The backend converts it to Q64.96 using each token's decimals. Provide this OR
   *  `initialSqrtPriceX96`. */
  price?: string;
}
