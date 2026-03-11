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
 * Parameters for executing a multi-token swap (uses exchange(i, j, ...) on StablePool)
 */
export interface MultiTokenSwapParams {
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  deadline: number;
}

/**
 * Parameters for adding liquidity to a multi-token pool
 */
export interface MultiTokenLiquidityParams {
  poolAddress: string;
  amounts: string[];  // amount for each coin index, "0" for coins not being deposited
  minMintAmount: string;
  deadline: number;
  stakeLPToken?: boolean;
}

/**
 * Parameters for removing liquidity from a multi-token pool
 */
export interface MultiTokenRemoveLiquidityParams {
  poolAddress: string;
  lpTokenAmount: string;
  minAmounts: string[];  // minimum amount for each coin index
  deadline: number;
  includeStakedLPToken?: boolean;
}

/**
 * Parameters for removing liquidity as a single token from a multi-token pool
 */
export interface MultiTokenRemoveLiquidityOneParams {
  poolAddress: string;
  lpTokenAmount: string;
  coinIndex: number;
  minReceived: string;
  deadline: number;
  includeStakedLPToken?: boolean;
}

/**
 * Parameters for adding liquidity with both tokens
 */
export interface LiquidityParams {
  poolAddress: string;
  tokenBAmount: string;
  maxTokenAAmount: string;
  deadline: number;
  stakeLPToken?: boolean; // If true, stake minted LP tokens in RewardsChef
}

/**
 * Parameters for adding liquidity with a single token
 */
export interface SingleTokenLiquidityParams {
  poolAddress: string;
  singleTokenAmount: string;
  isAToB: boolean;
  deadline: number;
  stakeLPToken?: boolean; // If true, stake minted LP tokens in RewardsChef
}

/**
 * Parameters for removing liquidity from a pool
 */
export interface RemoveLiquidityParams {
  poolAddress: string;
  lpTokenAmount: string;
  deadline: number;
  includeStakedLPToken?: boolean; // If true, unstake LP tokens from RewardsChef before burning
}

/**
 * Parameters for creating a new liquidity pool
 */
export interface CreatePoolParams {
  tokenA: string;
  tokenB: string;
  isStable?: boolean;
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
  images: Array<{ value: string }>; // Token images (filtered to exclude empty values)
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
  balance: string; // User LP token balance (unstaked, in wallet)
  price: string; // LP token price
  images: Array<{ value: string }>; // LP token images (filtered to exclude empty values)
  stakedBalance?: string; // LP tokens staked in RewardsChef (optional - only if pool exists in rewards)
  totalBalance: string; // Total LP tokens (balance + stakedBalance if exists, otherwise just balance)
}

/**
 * A coin in a multi-token pool
 */
export interface PoolCoin {
  coinIndex: number;
  address: string;
  _name: string;
  _symbol: string;
  customDecimals: number;
  _totalSupply: string;
  balance: string;      // user's wallet balance
  price: string;        // oracle price (USD)
  poolBalance: string;  // balance held in pool
  images: Array<{ value: string }>;
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
  isStable: boolean;
  isPaused: boolean;
  isDisabled: boolean;
  // Multi-token pool fields (populated when pool has more than 2 tokens)
  coins?: PoolCoin[];
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
  status: string;
  balances: TokenBalance[];
  images: Array<{ value: string }>;
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
  status: string;
  balances: TokenBalance[];
  images: Array<{ value: string }>;
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
  isStable: boolean;
  isPaused?: boolean;  // Optional for backward compatibility with older indexed pools
  isDisabled?: boolean;
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
 * Raw coin entry from the StablePool coins sub-table
 */
export interface RawPoolCoin {
  address: string;  // pool address
  key: number;      // coin index
  value: string;    // token address
}

/**
 * Raw token balance from the StablePool tokenBalances mapping sub-table
 */
export interface RawPoolTokenBalance {
  address: string;  // pool address
  key: string;      // token address
  value: string;    // balance
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
    isStable: boolean;
  };
}
