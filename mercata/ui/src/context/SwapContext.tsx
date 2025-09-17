import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from 'react';
import { LiquidityPool, SwappableToken, SwapHistoryEntry, SetPoolRatesData } from '@/interface';
import {api} from '@/lib/axios';

type SwapContextType = {
  swappableTokens: SwappableToken[];
  pairableTokens: SwappableToken[];
  loading: boolean; // For POST operations (swap, createPool, addLiquidity, removeLiquidity, setPoolRates)
  tokensLoading: boolean;
  pairablesLoading: boolean;
  poolsLoading: boolean;
  poolLoading: boolean; // Keep for live pool fetch/poll only
  error: string | null;
  // Current swap state
  fromAsset: SwappableToken | undefined;
  toAsset: SwappableToken | undefined;
  pool: LiquidityPool | null;
  setFromAsset: (asset: SwappableToken | undefined) => void;
  setToAsset: (asset: SwappableToken | undefined) => void;
  setPool: (pool: LiquidityPool | null) => void;
  // Functions
  refetchSwappableTokens: () => void;
  fetchPairableTokens: (tokenAddress: string) => Promise<SwappableToken[]>;
  createPool: (data: { tokenA: string; tokenB: string }) => Promise<void>;
  getPoolByTokenPair: (tokenA: string, tokenB: string, signal?: AbortSignal) => Promise<LiquidityPool>;
  getPoolByAddress: (address: string) => Promise<LiquidityPool>;
  swap: (data: {  
    poolAddress: string;
    isAToB: boolean;
    amountIn: string;
    minAmountOut: string;
  }) => Promise<void>;
  fetchPools: () => Promise<LiquidityPool[]>;
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
  fetchTokenBalances: (pool: LiquidityPool, userAddress: string, usdstAddress: string) => Promise<{
    tokenABalance: string;
    tokenBBalance: string;
    usdstBalance: string;
  }>;
  enrichPools: (pools: LiquidityPool[]) => LiquidityPool[];
  lpTokens: LiquidityPool[]
  fetchLpTokensPositions: () => Promise<void>;
  refreshSwapHistory: (params?: Record<string, string>) => Promise<void>;
  swapHistory: SwapHistoryEntry[];
  swapHistoryCount: number;
  swapHistoryLoading: boolean;
  setPoolRates: (data: SetPoolRatesData) => Promise<void>;
};

const SwapContext = createContext<SwapContextType | undefined>(undefined);

export const SwapProvider = ({ children }: { children: ReactNode }) => {
  const [swappableTokens, setSwappableTokens] = useState<SwappableToken[]>([]);
  const [pairableTokens, setPairableTokens] = useState<SwappableToken[]>([]);
  const [loading, setLoading] = useState<boolean>(false); // For POST operations (swap, createPool, addLiquidity, removeLiquidity, setPoolRates)
  const [tokensLoading, setTokensLoading] = useState<boolean>(false);
  const [pairablesLoading, setPairablesLoading] = useState<boolean>(false);
  const [poolsLoading, setPoolsLoading] = useState<boolean>(false);
  const [poolLoading, setPoolLoading] = useState<boolean>(false); // Keep for live pool fetch/poll only
  const [error, setError] = useState<string | null>(null);
  const [lpTokens, setLpTokens] = useState<LiquidityPool[]>([])
  // Current swap state
  const [fromAsset, setFromAsset] = useState<SwappableToken | undefined>();
  const [toAsset, setToAsset] = useState<SwappableToken | undefined>();
  const [pool, setPool] = useState<LiquidityPool | null>(null);
  const [swapHistory, setSwapHistory] = useState<SwapHistoryEntry[]>([]);
  const [swapHistoryCount, setSwapHistoryCount] = useState(0);
  const [swapHistoryLoading, setSwapHistoryLoading] = useState(false);

  // refs to track current requests and prevent stale updates
  const currentAssetPairRef = useRef<string>('');
  const historyAbortControllerRef = useRef<AbortController | null>(null);

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

  const fetchSwappableTokens = useCallback(async () => {
    setTokensLoading(true);
    setError(null);
    try {
      const res = await api.get<SwappableToken[]>('/swap-pools/tokens');
      setSwappableTokens(res.data || []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch swappable tokens');
    } finally {
      setTokensLoading(false);
    }
  }, []);

  const fetchPairableTokens = useCallback(async (tokenAddress: string): Promise<SwappableToken[]> => {
    if (!tokenAddress) return [];

    setPairablesLoading(true);
    setError(null);
    try {
      const res = await api.get<SwappableToken[]>(`/swap-pools/tokens/${tokenAddress}`);
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

  const createPool = useCallback(async (data: { tokenA: string; tokenB: string }) => {
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
      const res = await api.get(`/swap-pools/${tokenA}/${tokenB}`, { signal });
      const poolData = res.data?.[0] || null;
      if (poolData) {
        setPool(poolData);
        
        // Update asset balances from pool data
        if (fromAsset && toAsset) {
          // Update fromAsset balance from pool data
          const fromTokenBalance = poolData.tokenA?.address === fromAsset.address 
            ? poolData.tokenA?.balance 
            : poolData.tokenB?.address === fromAsset.address 
              ? poolData.tokenB?.balance 
              : fromAsset.balance;

          if (fromTokenBalance !== fromAsset.balance) {
            setFromAsset({ ...fromAsset, balance: fromTokenBalance || "0" });
          }

          // Update toAsset balance from pool data
          const toTokenBalance = poolData.tokenA?.address === toAsset.address 
            ? poolData.tokenA?.balance 
            : poolData.tokenB?.address === toAsset.address 
              ? poolData.tokenB?.balance 
              : toAsset.balance;

          if (toTokenBalance !== toAsset.balance) {
            setToAsset({ ...toAsset, balance: toTokenBalance || "0" });
          }
        }
      }
      return poolData;
    } finally {
      setPoolLoading(false);
    }
  }, [fromAsset, toAsset, setFromAsset, setToAsset]);

  const getPoolByAddress = useCallback(async (address: string) => {
    try {
      const res = await api.get(`/swap-pools/${address}`);
      return res.data || null;
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch pool by address');
      return null;
    }
  }, []);

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
      const res = await api.get('/swap-pools');
      return res.data || [];
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch LP tokens');
      return [];
    } finally {
      setPoolsLoading(false);
    }
  }, []);

  const addLiquidityDualToken = useCallback(async (data: {
    poolAddress: string;
    tokenBAmount: string;
    maxTokenAAmount: string;
  }) => {
    setLoading(true);
    try {
      const response = await api.post(`/swap-pools/${data.poolAddress}/liquidity`, {
        tokenBAmount: data.tokenBAmount,
        maxTokenAAmount: data.maxTokenAAmount
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
        isAToB: data.isAToB
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
        data: { lpTokenAmount: data.lpTokenAmount }
      });
      return response.data;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTokenBalances = useCallback(async (pool: LiquidityPool, _userAddress: string, usdstAddress: string) => {
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

  const fetchLpTokensPositions = useCallback(async () => {
    setPoolsLoading(true);
    setError(null);
    try {
      const res = await api.get('/swap-pools/positions');
      setLpTokens(res?.data || []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch LP positions');
    } finally {
      setPoolsLoading(false);
    }
  }, []);

  const enrichPools = useCallback((pools: LiquidityPool[]) => {
    return pools.map((pool: LiquidityPool) => ({
      ...pool,
      _name: `${pool.tokenA._name}/${pool.tokenB._name}`,
      _symbol: `${pool.tokenA._symbol}/${pool.tokenB._symbol}`,
    }));
  }, []);

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

  const setPoolRates = useCallback(async (data: SetPoolRatesData) => {
    setLoading(true);
    try {
      const response = await api.post('/swap-pools/set-rates', data);
      return response.data;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSwappableTokens();
  }, [fetchSwappableTokens]);

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
        fetchTokenBalances,
        enrichPools,
        lpTokens,
        fetchLpTokensPositions,
        refreshSwapHistory,
        swapHistory,
        swapHistoryCount,
        swapHistoryLoading,
        setPoolRates
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
