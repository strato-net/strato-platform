// ============================================================================
// SWAP OPERATION TYPES
// ============================================================================

/**
 * Parameters for executing a token swap
 */
export interface SwapParams {
  poolAddress: string;
  isAToB: boolean;
  amountIn: string;
  minAmountOut: string;
  deadline: number;
}

/**
 * Parameters for adding liquidity with both tokens
 */
export interface LiquidityParams {
  poolAddress: string;
  tokenBAmount: string;
  maxTokenAAmount: string;
  deadline: number;
}

/**
 * Parameters for adding liquidity with a single token
 */
export interface SingleTokenLiquidityParams {
  poolAddress: string;
  singleTokenAmount: string;
  isAToB: boolean;
  deadline: number;
}

/**
 * Parameters for removing liquidity from a pool
 */
export interface RemoveLiquidityParams {
  poolAddress: string;
  lpTokenAmount: string;
  deadline: number;
}

/**
 * Parameters for creating a new liquidity pool
 */
export interface CreatePoolParams {
  tokenA: string;
  tokenB: string;
}

/**
 * Parameters for setting pool fee rates
 */
export interface SetPoolRatesParams {
  poolAddress: string;
  swapFeeRate: number;
  lpSharePercent: number;
}

// ============================================================================
// SWAP DATA TYPES
// ============================================================================

/**
 * Historical swap transaction entry
 */
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

/**
 * Response containing swap history data
 */
export interface SwapHistoryResponse {
  data: SwapHistoryEntry[];
  totalCount: number;
}

/**
 * Generic transaction response
 */
export interface TransactionResponse {
  status: string;
  hash: string;
}

// ============================================================================
// POOL & TOKEN TYPES
// ============================================================================

/**
 * Token information within a swap context
 */
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

/**
 * Liquidity provider token information
 */
export interface LPToken {
  address: string;
  _name: string;
  _symbol: string;
  customDecimals: number;
  _totalSupply: string; // Total supply of LP tokens
  balance: string; // User LP token balance
  price: string; // LP token price
}

/**
 * Complete liquidity pool information
 */
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

/**
 * Array of pools
 */
export type PoolList = Pool[];

// ============================================================================
// RAW API DATA TYPES
// ============================================================================

/**
 * Token balance information from API
 */
export interface TokenBalance {
  key: string;
  value: string;
}

/**
 * Raw token data as received from API
 */
export interface RawToken {
  address: string;
  _name: string;
  _symbol: string;
  customDecimals?: number;
  _totalSupply: string;
  balances?: TokenBalance[];
}

/**
 * Raw LP token data as received from API
 */
export interface RawLPToken {
  address: string;
  _name: string;
  _symbol: string;
  customDecimals?: number;
  _totalSupply: string;
  balances?: TokenBalance[];
}

/**
 * Raw pool data as received from API
 */
export interface RawPool {
  address: string;
  tokenA: RawToken;
  tokenB: RawToken;
  lpToken: RawLPToken;
  tokenABalance: string;
  tokenBBalance: string;
  aToBRatio: string;
  bToARatio: string;
  swapFeeRate?: number;
  lpSharePercent?: number;
}

/**
 * Raw pool factory data as received from API
 */
export interface RawPoolFactory {
  swapFeeRate: number;
  lpSharePercent: number;
}

/**
 * Raw swap event data as received from API
 */
export interface RawSwapEvent {
  id: string;
  address: string;
  tokenIn: string;
  amountIn: string;
  amountOut: string;
  sender: string;
  block_timestamp: string;
  pool: {
    tokenA: {
      address: string;
      symbol: string;
    };
    tokenB: {
      address: string;
      symbol: string;
    };
  };
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if an object is a valid RawToken
 */
export function isRawToken(obj: any): obj is RawToken {
  return obj && 
    typeof obj.address === 'string' &&
    typeof obj._name === 'string' &&
    typeof obj._symbol === 'string' &&
    typeof obj._totalSupply === 'string';
}

/**
 * Type guard to check if an object is a valid RawLPToken
 */
export function isRawLPToken(obj: any): obj is RawLPToken {
  return obj &&
    typeof obj.address === 'string' &&
    typeof obj._name === 'string' &&
    typeof obj._symbol === 'string' &&
    typeof obj._totalSupply === 'string';
}

/**
 * Type guard to check if an object is a valid RawPool
 */
export function isRawPool(obj: any): obj is RawPool {
  return obj &&
    typeof obj.address === 'string' &&
    isRawToken(obj.tokenA) &&
    isRawToken(obj.tokenB) &&
    isRawLPToken(obj.lpToken) &&
    typeof obj.tokenABalance === 'string' &&
    typeof obj.tokenBBalance === 'string';
}

/**
 * Type guard to check if an object is a valid RawSwapEvent
 */
export function isRawSwapEvent(obj: any): obj is RawSwapEvent {
  return obj &&
    typeof obj.id === 'string' &&
    typeof obj.address === 'string' &&
    typeof obj.tokenIn === 'string' &&
    typeof obj.amountIn === 'string' &&
    typeof obj.amountOut === 'string' &&
    typeof obj.sender === 'string' &&
    typeof obj.block_timestamp === 'string' &&
    obj.pool &&
    obj.pool.tokenA &&
    obj.pool.tokenB;
} 