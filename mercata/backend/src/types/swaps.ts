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
  id: number;
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
  user: string;
  balance: string;
}

/**
 * Raw token data as received from API
 */
export interface RawToken {
  address: string;
  _name: string;
  _symbol: string;
  customDecimals: number;
  _totalSupply: string;
  balances: TokenBalance[];
}

/**
 * Raw LP token data as received from API
 */
export interface RawLPToken {
  address: string;
  _name: string;
  _symbol: string;
  customDecimals: number;
  _totalSupply: string;
  balances: TokenBalance[];
}

/**
 * Raw pool data as received from getRawPoolData API call
 */
export interface RawGetPool {
  address: string;
  tokenA: RawToken;
  tokenB: RawToken;
  lpToken: RawLPToken;
  tokenABalance: string;
  tokenBBalance: string;
  aToBRatio: string;
  bToARatio: string;
  swapFeeRate: number;
  lpSharePercent: number;
}

/**
 * Raw pool factory data as received from API
 */
export interface RawPoolFactory {
  swapFeeRate: number;
  lpSharePercent: number;
}

/**
 * Pool data with tokens for specific queries
 */
export interface PoolWithTokens {
  tokenA: RawToken;
  tokenB: RawToken;
  tokenABalance: string;
  tokenBBalance: string;
}

/**
 * Pool data with tokenB for specific queries
 */
export interface PoolWithTokenB {
  tokenB: RawToken;
  tokenBBalance: string;
}

/**
 * Pool data with tokenA for specific queries
 */
export interface PoolWithTokenA {
  tokenA: RawToken;
  tokenABalance: string;
}

/**
 * Pool data with just token addresses for specific queries
 */
export interface PoolWithTokenAddresses {
  tokenA: string;
  tokenB: string;
}

/**
 * Pool data with balances and LP token supply for removeLiquidity operations
 */
export interface PoolWithBalances {
  tokenABalance: string;
  tokenBBalance: string;
  lpToken: {
    _totalSupply: string;
  };
}

/**
 * Raw swap event data as received from API
 */
export interface RawSwapEvent {
  id: number;
  address: string;
  tokenIn: string;
  tokenOut: string;
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
    obj.address.length > 0 &&
    typeof obj._name === 'string' &&
    obj._name.length > 0 &&
    typeof obj._symbol === 'string' &&
    obj._symbol.length > 0 &&
    typeof obj._totalSupply === 'string' &&
    obj._totalSupply.length >= 0 &&
    typeof obj.customDecimals === 'number' &&
    obj.customDecimals >= 0 &&
    Array.isArray(obj.balances) && 
    obj.balances.every((b: any) => 
      typeof b.user === 'string' && 
      typeof b.balance === 'string' &&
      b.user.length > 0 &&
      b.balance.length >= 0
    );
}

/**
 * Type guard to check if an object is a valid RawLPToken
 */
export function isRawLPToken(obj: any): obj is RawLPToken {
  return obj &&
    typeof obj.address === 'string' &&
    obj.address.length > 0 &&
    typeof obj._name === 'string' &&
    obj._name.length > 0 &&
    typeof obj._symbol === 'string' &&
    obj._symbol.length > 0 &&
    typeof obj._totalSupply === 'string' &&
    obj._totalSupply.length >= 0 &&
    typeof obj.customDecimals === 'number' &&
    obj.customDecimals >= 0 &&
    Array.isArray(obj.balances) && 
    obj.balances.every((b: any) => 
      typeof b.user === 'string' && 
      typeof b.balance === 'string' &&
      b.user.length > 0 &&
      b.balance.length >= 0
    );
}

/**
 * Type guard to check if an object is a valid RawGetPool
 */
export function isRawGetPool(obj: any): obj is RawGetPool {
  return obj &&
    typeof obj.address === 'string' &&
    obj.address.length > 0 &&
    isRawToken(obj.tokenA) &&
    isRawToken(obj.tokenB) &&
    isRawLPToken(obj.lpToken) &&
    typeof obj.tokenABalance === 'string' &&
    obj.tokenABalance.length >= 0 &&
    typeof obj.tokenBBalance === 'string' &&
    obj.tokenBBalance.length >= 0 &&
    typeof obj.aToBRatio === 'string' &&
    obj.aToBRatio.length >= 0 &&
    typeof obj.bToARatio === 'string' &&
    obj.bToARatio.length >= 0 &&
    typeof obj.swapFeeRate === 'number' &&
    obj.swapFeeRate >= 0 &&
    obj.swapFeeRate <= 10000 &&
    typeof obj.lpSharePercent === 'number' &&
    obj.lpSharePercent >= 0 &&
    obj.lpSharePercent <= 10000;
}

/**
 * Type guard to check if an object is a valid RawSwapEvent
 */
export function isRawSwapEvent(obj: any): obj is RawSwapEvent {
  return obj &&
    typeof obj.id === 'number' &&
    obj.id != null &&
    typeof obj.address === 'string' &&
    obj.address.length > 0 &&
    typeof obj.tokenIn === 'string' &&
    obj.tokenIn.length > 0 &&
    typeof obj.tokenOut === 'string' &&
    obj.tokenOut.length > 0 &&
    typeof obj.amountIn === 'string' &&
    obj.amountIn.length >= 0 &&
    typeof obj.amountOut === 'string' &&
    obj.amountOut.length >= 0 &&
    typeof obj.sender === 'string' &&
    obj.sender.length > 0 &&
    typeof obj.block_timestamp === 'string' &&
    obj.block_timestamp.length > 0 &&
    obj.pool &&
    obj.pool.tokenA &&
    obj.pool.tokenB;
}

/**
 * Type guard to check if an object is a valid RawPoolFactory
 */
export function isRawPoolFactory(obj: any): obj is RawPoolFactory {
  return obj &&
    typeof obj.swapFeeRate === 'number' &&
    obj.swapFeeRate >= 0 &&
    typeof obj.lpSharePercent === 'number' &&
    obj.lpSharePercent >= 0;
}

/**
 * Type guard to check if an object is a valid PoolWithBalances
 */
export function isPoolWithBalances(obj: any): obj is PoolWithBalances {
  return obj &&
    typeof obj.tokenABalance === 'string' &&
    obj.tokenABalance.length > 0 &&
    obj.tokenABalance !== "0" &&
    typeof obj.tokenBBalance === 'string' &&
    obj.tokenBBalance.length > 0 &&
    obj.tokenBBalance !== "0" &&
    obj.lpToken &&
    typeof obj.lpToken._totalSupply === 'string' &&
    obj.lpToken._totalSupply.length > 0 &&
    obj.lpToken._totalSupply !== "0";
}

// ============================================================================
// UNIFIED API VALIDATION HELPERS
// ============================================================================

/**
 * Validates and transforms an array of raw pool data from getRawPoolData
 */
export function validateGetPoolArray(data: unknown): RawGetPool[] {
  if (!Array.isArray(data)) {
    throw new Error("Expected array of pools from API");
  }
  
  return data.map((item, index) => {
    if (!isRawGetPool(item)) {
      throw new Error(`Invalid pool data at index ${index}: ${JSON.stringify(item)}`);
    }
    return item;
  });
}

/**
 * Validates and transforms an array of raw swap events
 */
export function validateSwapEventArray(data: unknown): RawSwapEvent[] {
  if (!Array.isArray(data)) {
    throw new Error("Expected array of swap events from API");
  }
  
  return data.map((item, index) => {
    if (!isRawSwapEvent(item)) {
      throw new Error(`Invalid swap event data at index ${index}: ${JSON.stringify(item)}`);
    }
    return item;
  });
}

/**
 * Validates and transforms an array of pool data with tokens
 */
export function validatePoolWithTokensArray(data: unknown): PoolWithTokens[] {
  if (!Array.isArray(data)) {
    throw new Error("Expected array of pools with tokens from API");
  }
  
  return data.map((item, index) => {
    if (!item.tokenA || !item.tokenB || 
        typeof item.tokenABalance !== 'string' || 
        typeof item.tokenBBalance !== 'string') {
      throw new Error(`Invalid pool with tokens structure at index ${index}: ${JSON.stringify(item)}`);
    }
    
    if (!isRawToken(item.tokenA)) {
      throw new Error(`Invalid tokenA at index ${index}: ${JSON.stringify(item.tokenA)}`);
    }
    
    if (!isRawToken(item.tokenB)) {
      throw new Error(`Invalid tokenB at index ${index}: ${JSON.stringify(item.tokenB)}`);
    }
    
    return item as PoolWithTokens;
  });
}

/**
 * Validates and transforms an array of pool data with tokenA
 */
export function validatePoolWithTokenAArray(data: unknown): PoolWithTokenA[] {
  if (!Array.isArray(data)) {
    throw new Error("Expected array of pools with tokenA from API");
  }
  
  return data.map((item, index) => {
    if (!item.tokenA || typeof item.tokenABalance !== 'string') {
      throw new Error(`Invalid pool with tokenA structure at index ${index}: ${JSON.stringify(item)}`);
    }
    
    if (!isRawToken(item.tokenA)) {
      throw new Error(`Invalid tokenA at index ${index}: ${JSON.stringify(item.tokenA)}`);
    }
    
    return item as PoolWithTokenA;
  });
}

/**
 * Validates and transforms an array of pool data with tokenB
 */
export function validatePoolWithTokenBArray(data: unknown): PoolWithTokenB[] {
  if (!Array.isArray(data)) {
    throw new Error("Expected array of pools with tokenB from API");
  }
  
  return data.map((item, index) => {
    if (!item.tokenB || typeof item.tokenBBalance !== 'string') {
      throw new Error(`Invalid pool with tokenB structure at index ${index}: ${JSON.stringify(item)}`);
    }
    
    if (!isRawToken(item.tokenB)) {
      throw new Error(`Invalid tokenB at index ${index}: ${JSON.stringify(item.tokenB)}`);
    }
    
    return item as PoolWithTokenB;
  });
}

/**
 * Validates and transforms an array of pool data with token addresses
 */
export function validatePoolWithTokenAddressesArray(data: unknown): PoolWithTokenAddresses {
  if (!data) {
    throw new Error("Pool with token addresses data is required but was not provided");
  }
  
  if (!Array.isArray(data)) {
    throw new Error("Expected array of pools with token addresses from API");
  }

  if (data.length === 0) {
    throw new Error("No pool with token addresses data found");
  }

  if (data.length > 1) {
    throw new Error(`Expected single pool with token addresses, found ${data.length} pools`);
  }
  
  const item = data[0];
  if (typeof item.tokenA !== 'string' || typeof item.tokenB !== 'string') {
    throw new Error(`Invalid pool with token addresses structure: ${JSON.stringify(item)}`);
  }
  
  return item as PoolWithTokenAddresses;
}

/**
 * Validates and transforms a single RawPoolFactory object from API response
 */
export function validateSinglePoolFactory(data: unknown): RawPoolFactory {
  if (!data) {
    throw new Error("Pool factory data is required but was not provided");
  }
  
  if (!Array.isArray(data)) {
    throw new Error("Expected array of pool factory data from API");
  }
  
  if (data.length === 0) {
    throw new Error("No pool factory data found");
  }
  
  if (data.length > 1) {
    throw new Error(`Expected single pool factory, found ${data.length}`);
  }
  
  const factoryData = data[0];
  if (!isRawPoolFactory(factoryData)) {
    throw new Error(`Invalid pool factory data: ${JSON.stringify(factoryData)}`);
  }
  
  return factoryData;
}

/**
 * Validates and transforms a single PoolWithBalances object from API response
 */
export function validateSinglePoolWithBalances(data: unknown): PoolWithBalances {
  if (!data) {
    throw new Error("Pool balances data is required but was not provided");
  }
  
  if (!Array.isArray(data)) {
    throw new Error("Expected array of pool balances data from API");
  }
  
  if (data.length === 0) {
    throw new Error("No pool balances data found");
  }
  
  if (data.length > 1) {
    throw new Error(`Expected single pool balances, found ${data.length}`);
  }
  
  const poolData = data[0];
  if (!isPoolWithBalances(poolData)) {
    // Check for specific zero value errors
    if (poolData?.tokenABalance === "0") {
      throw new Error("Pool tokenA balance cannot be zero");
    }
    if (poolData?.tokenBBalance === "0") {
      throw new Error("Pool tokenB balance cannot be zero");
    }
    if (poolData?.lpToken?._totalSupply === "0") {
      throw new Error("Pool LP token total supply cannot be zero");
    }
    throw new Error(`Invalid pool balances data: ${JSON.stringify(poolData)}`);
  }
  
  return poolData;
}
