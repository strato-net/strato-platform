// ---------------- Swap Types ----------------
export interface SwapHistoryEntry {
  id: string;
  timestamp: Date;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  impliedPrice: string;
  sender: string;
}

export interface SwapQuote {
  amountOut: string;
  priceImpact: string;
  fee: string;
}

export interface SwapParams {
  poolAddress: string;
  isAToB: boolean;
  amountIn: string;
  minAmountOut: string;
}

export interface LiquidityParams {
  poolAddress: string;
  tokenBAmount: string;
  maxTokenAAmount: string;
}

export interface RemoveLiquidityParams {
  poolAddress: string;
  lpTokenAmount: string;
}

// ---------------- Pool Types ----------------

export interface SwapToken {
  address: string;
  _name: string;
  _symbol: string;
  customDecimals: number;
  _totalSupply: string; // Total supply of the token
  balance: string; // User balance
  price: string; // Token price
  poolBalance: string; // Pool balance of this token
}

export interface LPToken {
  address: string;
  _name: string;
  _symbol: string;
  customDecimals: number;
  _totalSupply: string; // Total supply of LP tokens
  balance: string; // User LP token balance
  price: string; // LP token price
}

export interface Pool {
  address: string;
  poolName: string; // TokenA-TokenB format
  poolSymbol: string; // TokenA-TokenB symbol format
  tokenA: SwapToken;
  tokenB: SwapToken;
  lpToken: LPToken;
  swapFeeRate: number;
  lpSharePercent: number;
  aToBRatio: string; // Pool's A to B ratio
  bToARatio: string; // Pool's B to A ratio
  totalLiquidityUSD: string;
  tradingVolume24h: string;
  apy: string;
  oracleAToBRatio: string;
  oracleBToARatio: string;
}

export type PoolList = Pool[]; 