import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from 'react';
import { Pool, SwapHistoryEntry, SetPoolRatesParams, SwapToken, SwapContextType } from '@/interface';
import {api} from '@/lib/axios';
import { useUser } from '@/context/UserContext';

// ============================================================================
// TYPES
// ============================================================================

// SwapContextType is now imported from @/interface

const SwapContext = createContext<SwapContextType | undefined>(undefined);

export const SwapProvider = ({ children }: { children: ReactNode }) => {
  const { isLoggedIn } = useUser();
  
  // ============================================================================
  // STATE
  // ============================================================================
  
  // Token data
  const [swappableTokens, setSwappableTokens] = useState<SwapToken[]>([]);
  const [pairableTokens, setPairableTokens] = useState<SwapToken[]>([]);
  const [userPools, setUserPools] = useState<Pool[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  
  // Loading states
  const [loading, setLoading] = useState<boolean>(false); // For POST operations
  const [tokensLoading, setTokensLoading] = useState<boolean>(false);
  const [pairablesLoading, setPairablesLoading] = useState<boolean>(false);
  const [poolsLoading, setPoolsLoading] = useState<boolean>(false);
  const [poolLoading, setPoolLoading] = useState<boolean>(false); // For live pool fetch/poll only
  const [swapHistoryLoading, setSwapHistoryLoading] = useState(false);
  
  // Error state
  const [error, setError] = useState<string | null>(null);
  
  // Current swap state
  const [fromAsset, setFromAsset] = useState<SwapToken | undefined>();
  const [toAsset, setToAsset] = useState<SwapToken | undefined>();
  const [pool, setPool] = useState<Pool | null>(null);
  
  // Swap history
  const [swapHistory, setSwapHistory] = useState<SwapHistoryEntry[]>([]);
  const [swapHistoryCount, setSwapHistoryCount] = useState(0);

  // ============================================================================
  // REFS
  // ============================================================================
  const currentAssetPairRef = useRef<string>('');
  const historyAbortControllerRef = useRef<AbortController | null>(null);

  // ============================================================================
  // EFFECTS
  // ============================================================================
  
  // Clear refs when pool changes
  useEffect(() => {
    if (!pool?.address) {
      currentAssetPairRef.current = '';
    }
  }, [pool?.address]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (historyAbortControllerRef.current) {
        historyAbortControllerRef.current.abort();
      }
    };
  }, []);

  // ============================================================================
  // FUNCTIONS
  // ============================================================================
  
  // Token fetching
  const fetchSwappableTokens = useCallback(async () => {
    setTokensLoading(true);
    setError(null);
    try {
      const res = await api.get<SwapToken[]>('/swap-pools/tokens');
      setSwappableTokens(res.data || []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch swappable tokens');
    } finally {
      setTokensLoading(false);
    }
  }, []);

  const fetchPairableTokens = useCallback(async (tokenAddress: string): Promise<SwapToken[]> => {
    if (!tokenAddress) return [];

    setPairablesLoading(true);
    setError(null);
    try {
      const res = await api.get<SwapToken[]>(`/swap-pools/tokens/${tokenAddress}`);
      const tokens = res.data || [];
      setPairableTokens(tokens);
      return tokens;
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch pairable tokens');
      return [];
    } finally {
      setPairablesLoading(false);
    }
  }, []);

  // Pool operations
  const createPool = useCallback(async (data: { tokenA: string; tokenB: string, isStable: boolean }) => {
    setLoading(true);
    try {
      await api.post('/swap-pools', data);
    } finally {
      setLoading(false);
    }
  }, []);

  const getPoolByTokenPair = useCallback(async (tokenA: string, tokenB: string, signal?: AbortSignal) => {
    setPoolLoading(true);
    try {
      const { data } = await api.get(`/swap-pools/${tokenA}/${tokenB}`, { signal });
      const poolData: Pool | null = data?.[0] || null;

      if (poolData) {
        setPool(poolData);

        const read = (addr?: string) => {
          if (!addr) return { balance: "0", poolBalance: "0", price: "0" };
          // For multi-token pools, check coins array first
          if (poolData.coins && poolData.coins.length > 2) {
            const coin = poolData.coins.find(c => c.address === addr);
            if (coin) return { balance: coin.balance || "0", poolBalance: coin.poolBalance || "0", price: coin.price || "0" };
          }
          const token = poolData.tokenA?.address === addr ? poolData.tokenA : poolData.tokenB?.address === addr ? poolData.tokenB : null;
          return token ? { balance: token.balance || "0", poolBalance: token.poolBalance || "0", price: token.price || "0" } : { balance: "0", poolBalance: "0", price: "0" };
        };

        setFromAsset(prev => prev ? { ...prev, ...read(prev.address) } : prev);
        setToAsset(prev => prev ? { ...prev, ...read(prev.address) } : prev);

        return poolData;
      }

      // No 2-token pool — check for a multi-token pool where both tokens have balance > 0
      const multiPool = pools.find(p =>
        p.coins && p.coins.length > 2 &&
        p.coins.some(c => c.address === tokenA && BigInt(c.poolBalance || "0") > 0n) &&
        p.coins.some(c => c.address === tokenB && BigInt(c.poolBalance || "0") > 0n)
      );
      if (multiPool) {
        setPool(multiPool);
        setFromAsset(prev => {
          if (!prev) return prev;
          const coin = multiPool.coins!.find(c => c.address === prev.address);
          return coin ? { ...prev, balance: coin.balance || "0", poolBalance: coin.poolBalance || "0", price: coin.price || "0" } : prev;
        });
        setToAsset(prev => {
          if (!prev) return prev;
          const coin = multiPool.coins!.find(c => c.address === prev.address);
          return coin ? { ...prev, balance: coin.balance || "0", poolBalance: coin.poolBalance || "0", price: coin.price || "0" } : prev;
        });
        return multiPool;
      }

      return null;
    } finally {
      setPoolLoading(false);
    }
  }, [setPool, setFromAsset, setToAsset, pools]);

  const getPoolByAddress = useCallback(async (address: string) => {
    try {
      const res = await api.get(`/swap-pools/${address}`);
      return res.data || null;
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch pool by address');
      return null;
    }
  }, []);

  const setPoolRates = useCallback(async (data: SetPoolRatesParams) => {
    setLoading(true);
    try {
      const response = await api.post('/swap-pools/set-rates', data);
      return response.data;
    } finally {
      setLoading(false);
    }
  }, []);

  const togglePause = useCallback(async (poolAddress: string, isPaused: boolean) => {
    setLoading(true);
    try {
      const response = await api.post('/swap-pools/toggle-pause', { poolAddress, isPaused });
      return response.data;
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleDisable = useCallback(async (poolAddress: string, isDisabled: boolean) => {
    setLoading(true);
    try {
      const response = await api.post('/swap-pools/toggle-disable', { poolAddress, isDisabled });
      return response.data;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUserPositions = useCallback(async () => {
    setPoolsLoading(true);
    setError(null);
    try {
      const res = await api.get('/swap-pools/positions');
      setUserPools(res?.data || []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch LP positions');
    } finally {
      setPoolsLoading(false);
    }
  }, []);

  // Swap operations
  const swap = useCallback(async (data: {
    poolAddress: string;
    isAToB: boolean;
    amountIn: string;
    minAmountOut: string;
  }) => {
    setLoading(true);
    try {
      const res = await api.post("/swap", data);
      return res.data;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPools = useCallback(async () => {
    setPoolsLoading(true);
    setError(null);
    try {
      const res = await api.get<Pool[]>('/swap-pools');
      const list = res.data || [];
      setPools(list);
      return list;
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch LP tokens');
      setPools([]);
      return [];
    } finally {
      setPoolsLoading(false);
    }
  }, []);

  // Liquidity operations
  const addLiquidityDualToken = useCallback(async (data: {
    poolAddress: string;
    tokenBAmount: string;
    maxTokenAAmount: string;
  }) => {
    setLoading(true);
    try {
      const response = await api.post(`/swap-pools/${data.poolAddress}/liquidity`, {
        tokenBAmount: data.tokenBAmount,
        maxTokenAAmount: data.maxTokenAAmount,
      });
      return response.data;
    } finally {
      setLoading(false);
    }
  }, []);

  const addLiquiditySingleToken = useCallback(async (data: {
    poolAddress: string;
    singleTokenAmount: string;
    isAToB: boolean;
  }) => {
    setLoading(true);
    try {
      const response = await api.post(`/swap-pools/${data.poolAddress}/liquidity/single`, {
        singleTokenAmount: data.singleTokenAmount,
        isAToB: data.isAToB,
      });
      return response.data;
    } finally {
      setLoading(false);
    }
  }, []);

  const removeLiquidity = useCallback(async (data: {
    poolAddress: string;
    lpTokenAmount: string;
  }) => {
    setLoading(true);
    try {
      const response = await api.delete(`/swap-pools/${data.poolAddress}/liquidity`, {
        data: {
          lpTokenAmount: data.lpTokenAmount,
        }
      });
      return response.data;
    } finally {
      setLoading(false);
    }
  }, []);

  // Multi-token pool operations
  const swapMultiToken = useCallback(async (data: {
    poolAddress: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    minAmountOut: string;
  }) => {
    setLoading(true);
    try {
      const res = await api.post("/swap/multi-token", data);
      return res.data;
    } finally {
      setLoading(false);
    }
  }, []);

  const addLiquidityMultiToken = useCallback(async (data: {
    poolAddress: string;
    amounts: string[];
    minMintAmount: string;
    stakeLPToken?: boolean;
  }) => {
    setLoading(true);
    try {
      const response = await api.post(`/swap-pools/${data.poolAddress}/liquidity/multi-token`, {
        amounts: data.amounts,
        minMintAmount: data.minMintAmount,
        stakeLPToken: data.stakeLPToken,
      });
      return response.data;
    } finally {
      setLoading(false);
    }
  }, []);

  const removeLiquidityMultiToken = useCallback(async (data: {
    poolAddress: string;
    lpTokenAmount: string;
    minAmounts: string[];
    includeStakedLPToken?: boolean;
  }) => {
    setLoading(true);
    try {
      const response = await api.delete(`/swap-pools/${data.poolAddress}/liquidity/multi-token`, {
        data: {
          lpTokenAmount: data.lpTokenAmount,
          minAmounts: data.minAmounts,
          includeStakedLPToken: data.includeStakedLPToken,
        }
      });
      return response.data;
    } finally {
      setLoading(false);
    }
  }, []);

  const removeLiquidityMultiTokenOneCoin = useCallback(async (data: {
    poolAddress: string;
    lpTokenAmount: string;
    coinIndex: number;
    minReceived: string;
    includeStakedLPToken?: boolean;
  }) => {
    setLoading(true);
    try {
      const response = await api.delete(`/swap-pools/${data.poolAddress}/liquidity/multi-token/one-coin`, {
        data: {
          lpTokenAmount: data.lpTokenAmount,
          coinIndex: data.coinIndex,
          minReceived: data.minReceived,
          includeStakedLPToken: data.includeStakedLPToken,
        }
      });
      return response.data;
    } finally {
      setLoading(false);
    }
  }, []);

  // Utility functions
  const fetchTokenBalances = useCallback(async (pool: Pool, _userAddress: string, usdstAddress: string) => {
    const [balanceA, balanceB, balanceUsdst] = await Promise.all([
      api.get(`/tokens/balance?address=eq.${pool.tokenA.address}`),
      api.get(`/tokens/balance?address=eq.${pool.tokenB.address}`),
      api.get(`/tokens/balance?address=eq.${usdstAddress}`)
    ]);
    
    return {
      tokenABalance: balanceA?.data[0]?.balance || "0",
      tokenBBalance: balanceB?.data[0]?.balance || "0",
      usdstBalance: balanceUsdst?.data[0]?.balance || "0"
    };
  }, []);

  // History operations
  const refreshSwapHistory = useCallback(
    async (params?: Record<string, string>) => {
      const poolAddress = pool?.address;
      if (!poolAddress) return;
  
      historyAbortControllerRef.current?.abort();
      historyAbortControllerRef.current = new AbortController();
  
      currentAssetPairRef.current = poolAddress;
      setSwapHistoryLoading(true);
  
      try {
        const { data } = await api.get(`/swap-history/${poolAddress}`, { params });
        
        if (currentAssetPairRef.current !== poolAddress) return;
        
        setSwapHistory(data.data.map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp)
        })));
        setSwapHistoryCount(data.totalCount);
      } catch (err) {
        if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') return;
        
        if (currentAssetPairRef.current === poolAddress) {
          setSwapHistory([]);
          setSwapHistoryCount(0);
        }
      } finally {
        if (currentAssetPairRef.current === poolAddress) {
          setSwapHistoryLoading(false);
        }
      }
    },
    [pool?.address]
  );

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  useEffect(() => {
    // Pool data is public - always fetch for all users
    fetchPools();
    
    // User-specific token data - only fetch when logged in
    if (isLoggedIn) {
      fetchSwappableTokens();
    }
  }, [fetchSwappableTokens, fetchPools, isLoggedIn]);

  // ============================================================================
  // PROVIDER
  // ============================================================================
  return (
    <SwapContext.Provider
      value={{
        swappableTokens,
        pairableTokens,
        loading,
        tokensLoading,
        pairablesLoading,
        poolsLoading,
        poolLoading,
        error,
        // Current swap state
        fromAsset,
        toAsset,
        pool,
        setFromAsset,
        setToAsset,
        setPool,
        // Functions
        refetchSwappableTokens: fetchSwappableTokens,
        fetchPairableTokens,
        createPool,
        getPoolByTokenPair,
        getPoolByAddress,
        swap,
        fetchPools,
        addLiquidityDualToken,
        addLiquiditySingleToken,
        removeLiquidity,
        swapMultiToken,
        addLiquidityMultiToken,
        removeLiquidityMultiToken,
        removeLiquidityMultiTokenOneCoin,
        fetchTokenBalances,
        userPools,
        fetchUserPositions,
        refreshSwapHistory,
        swapHistory,
        swapHistoryCount,
        swapHistoryLoading,
        setPoolRates,
        togglePause,
        toggleDisable,
        pools
      }}
    >
      {children}
    </SwapContext.Provider>
  );
};

export const useSwapContext = (): SwapContextType => {
  const context = useContext(SwapContext);
  if (!context) throw new Error('useSwapContext must be used within a SwapProvider');
  return context;
};
