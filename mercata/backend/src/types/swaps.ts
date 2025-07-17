// ---------------- Swap Types ----------------
export interface SwapHistoryEntry {
  id: string;
  timestamp: Date;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  impliedPrice: string;
  txHash: string;
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