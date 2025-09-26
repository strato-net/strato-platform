
// Import shared types for use in UI-specific interface definitions
import type {
  SwapHistoryEntry,
  SwapParams,
  SetPoolRatesParams,
  Pool,
  SwapToken,
} from '@shared/swap-types';
import { SafetyModuleData } from '.';

export * from '@shared/swap-types';
// UI-SPECIFIC SWAP INTERFACES
// ============================================================================

/**
 * UI-specific swap context state
 */
export interface SwapContextState {
  // Token data
  swappableTokens: SwapToken[];
  pairableTokens: SwapToken[];
  userPools: Pool[];
  
  // Loading states
  loading: boolean;
  tokensLoading: boolean;
  pairablesLoading: boolean;
  poolsLoading: boolean;
  poolLoading: boolean;
  swapHistoryLoading: boolean;
  
  // Error state
  error: string | null;
  
  // Current swap state
  fromAsset: SwapToken | undefined;
  toAsset: SwapToken | undefined;
  pool: Pool | null;
  
  // Swap history
  swapHistory: SwapHistoryEntry[];
  swapHistoryCount: number;
}

/**
 * UI-specific swap context actions
 */
export interface SwapContextActions {
  // Token selection
  setFromAsset: (asset: SwapToken | undefined) => void;
  setToAsset: (asset: SwapToken | undefined) => void;
  setPool: (pool: Pool | null) => void;
  
  // Token fetching
  refetchSwappableTokens: () => void;
  fetchPairableTokens: (tokenAddress: string) => Promise<SwapToken[]>;
  
  // Pool operations
  createPool: (data: { tokenA: string; tokenB: string }) => Promise<void>;
  getPoolByTokenPair: (tokenA: string, tokenB: string, signal?: AbortSignal) => Promise<Pool>;
  getPoolByAddress: (address: string) => Promise<Pool>;
  fetchPools: () => Promise<Pool[]>;
  setPoolRates: (data: SetPoolRatesParams) => Promise<void>;
  fetchUserPositions: () => Promise<void>;
  
  // Swap operations
  swap: (data: {  
    poolAddress: string;
    isAToB: boolean;
    amountIn: string;
    minAmountOut: string;
  }) => Promise<void>;
  
  // Liquidity operations
  addLiquidityDualToken: (data: {
    poolAddress: string;
    tokenBAmount: string;
    maxTokenAAmount: string;
  }) => Promise<void>;
  addLiquiditySingleToken: (data: {
    poolAddress: string;
    singleTokenAmount: string;
    isAToB: boolean;
  }) => Promise<void>;
  removeLiquidity: (data: {
    poolAddress: string;
    lpTokenAmount: string;
  }) => Promise<void>;
  
  // Utility functions
  fetchTokenBalances: (pool: Pool, userAddress: string, usdstAddress: string) => Promise<{
    tokenABalance: string;
    tokenBBalance: string;
    usdstBalance: string;
  }>;
  
  // History operations
  refreshSwapHistory: (params?: Record<string, string>) => Promise<void>;
}

/**
 * Complete swap context type
 */
export type SwapContextType = SwapContextState & SwapContextActions;

// ============================================================================
// COMPONENT-SPECIFIC INTERFACES
// ============================================================================

/**
 * Props for swap widget components
 */
export interface SwapWidgetProps {
  pool: Pool | null;
  fromAsset: SwapToken | null;
  toAsset: SwapToken | null;
  onAssetChange: (asset: SwapToken, isFrom: boolean) => void;
  onSwap: (params: SwapParams) => Promise<void>;
  loading?: boolean;
}

/**
 * Props for pool participation components
 */
export interface PoolParticipationProps {
  liquidityInfo: any;
  loadingLiquidity: any;
  userPools: Pool[];
  loadingUserPools: boolean;
  shouldPreventFlash?: boolean;
  safetyInfo?: SafetyModuleData | null;
  loadingSafety?: boolean;
}

/**
 * Props for LP token dropdown components
 */
export interface LPTokenDropdownProps {
  lpToken: Pool;
  className?: string;
  isExpanded: boolean;
}

/**
 * Props for pool creation components
 */
export interface CreatePoolProps {
  onSuccess?: () => Promise<void>;
  onCancel?: () => void;
}

/**
 * Props for pool rate setting components
 */
export interface SetPoolRatesProps {
  pool: Pool | null;
  onSuccess?: () => Promise<void>;
  onCancel?: () => void;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Swap calculation result
 */
export interface SwapCalculation {
  inputAmount: string;
  outputAmount: string;
  priceImpact: string;
  minimumReceived: string;
  exchangeRate: string;
  oracleExchangeRate: string;
}

/**
 * Liquidity calculation result
 */
export interface LiquidityCalculation {
  tokenAAmount: string;
  tokenBAmount: string;
  lpTokenAmount: string;
  sharePercentage: string;
  priceImpact: string;
}

/**
 * Pool statistics
 */
export interface PoolStats {
  totalLiquidity: string;
  volume24h: string;
  apy: string;
  feeRate: number;
  lpSharePercent: number;
}

/**
 * Token pair for pool operations
 */
export interface TokenPair {
  tokenA: SwapToken;
  tokenB: SwapToken;
  pool?: Pool;
}

/**
 * Swap form state
 */
export interface SwapFormState {
  fromAmount: string;
  toAmount: string;
  slippage: number;
  deadline: number;
  isAToB: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Liquidity form state
 */
export interface LiquidityFormState {
  tokenAAmount: string;
  tokenBAmount: string;
  singleTokenAmount: string;
  isSingleToken: boolean;
  isAToB: boolean;
  loading: boolean;
  error: string | null;
}
