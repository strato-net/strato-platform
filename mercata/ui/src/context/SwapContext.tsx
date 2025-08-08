import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { LiquidityPool, SwappableToken, SwapHistoryEntry, SetPoolRatesData } from '@/interface';
import {api} from '@/lib/axios';

type SwapContextType = {
  swappableTokens: SwappableToken[];
  pairableTokens: SwappableToken[];
  loading: boolean;
  error: string | null;
  // Current swap state
  fromAsset: SwappableToken | undefined;
  toAsset: SwappableToken | undefined;
  pool: LiquidityPool | null;
  setFromAsset: (asset: SwappableToken | undefined) => void;
  setToAsset: (asset: SwappableToken | undefined) => void;
  setPool: (pool: LiquidityPool | null) => void;
  // Fee data
  swapFeeRate: string;
  swapFeeRatePercent: number;
  feesLoading: boolean;
  feesError: string | null;
  // Functions
  refetchSwappableTokens: () => void;
  fetchPairableTokens: (tokenAddress: string) => void;
  createPool: (data: { tokenA: string; tokenB: string }) => Promise<void>;
  calculateSwap: (params: {
    poolAddress: string;
    isAToB: boolean;
    amountIn: string;
    reverse?: boolean;
    signal?: AbortSignal;
  }) => Promise<string>;
  getPoolByTokenPair: (tokenA: string, tokenB: string, signal?: AbortSignal) => Promise<LiquidityPool>;
  getPoolByAddress: (address: string) => Promise<LiquidityPool>;
  swap: (data: {  
    poolAddress: string;
    isAToB: boolean;
    amountIn: string;
    minAmountOut: string;
  }) => Promise<void>;
  fetchPools: () => Promise<LiquidityPool[]>;
  addLiquidity: (data: {
    poolAddress: string;
    tokenBAmount: string;
    maxTokenAAmount: string;
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
  getTokenBalance: (tokenAddress: string) => Promise<string>;
  enrichPools: (pools: LiquidityPool[]) => LiquidityPool[];
  lpTokens: LiquidityPool[]
  fetchLpTokensPositions: () => Promise<void>;
  fetchSwapHistory: (poolAddress: string, params?: Record<string, string>) => Promise<{ data: SwapHistoryEntry[]; totalCount: number }>;
  refreshSwapHistory: (params?: Record<string, string>) => Promise<void>;
  swapHistory: SwapHistoryEntry[];
  swapHistoryCount: number;
  setPoolRates: (data: SetPoolRatesData) => Promise<void>;
};

const SwapContext = createContext<SwapContextType | undefined>(undefined);

export const SwapProvider = ({ children }: { children: ReactNode }) => {
  const [swappableTokens, setSwappableTokens] = useState<SwappableToken[]>([]);
  const [pairableTokens, setPairableTokens] = useState<SwappableToken[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lpTokens, setLpTokens] = useState<LiquidityPool[]>([])
  // Current swap state
  const [fromAsset, setFromAsset] = useState<SwappableToken | undefined>();
  const [toAsset, setToAsset] = useState<SwappableToken | undefined>();
  const [pool, setPool] = useState<LiquidityPool | null>(null);
  const [swapHistory, setSwapHistory] = useState<SwapHistoryEntry[]>([]);
  const [swapHistoryCount, setSwapHistoryCount] = useState(0);
  // Fee state
  const [swapFeeRate, setSwapFeeRate] = useState<string>("---");
  const [swapFeeRatePercent, setSwapFeeRatePercent] = useState<number>(0.00);
  const [feesLoading, setFeesLoading] = useState<boolean>(false);
  const [feesError, setFeesError] = useState<string | null>(null);

  const fetchSwappableTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<SwappableToken[]>('/swap-pools/tokens');
      setSwappableTokens(res.data || []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch swappable tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPairableTokens = useCallback(async (tokenAddress: string) => {
    if (!tokenAddress) return;

    setLoading(true);
    setError(null);
    try {
      const res = await api.get<SwappableToken[]>(`/swap-pools/tokens/${tokenAddress}`);
      setPairableTokens(res.data || []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch pairable tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFees = useCallback(async () => {
    setFeesLoading(true);
    setFeesError(null);
    try {
      const response = await api.get('/fees/swap-rate');
      const data = response.data;
      
      setSwapFeeRate(data.swapFeeRatePercent?.toString() || "???");
      setSwapFeeRatePercent(data.swapFeeRatePercent || 0);
    } catch (err) {
      setFeesError('Failed to fetch fees from Cirrus');
      console.error('Error fetching fees:', err);
    } finally {
      setFeesLoading(false);
    }
  }, []);

  const createPool = useCallback(async (data: { tokenA: string; tokenB: string }) => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/swap-pools', data);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create pool');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const calculateSwap = useCallback(async ({
    poolAddress,
    isAToB,
    amountIn,
    reverse = false,
    signal
  }: {
    poolAddress: string;
    isAToB: boolean;
    amountIn: string;
    reverse?: boolean;
    signal?: AbortSignal;
  }) => {
    const { data } = await api.get(
      `/swap/quote?poolAddress=${poolAddress}&isAToB=${isAToB}&amountIn=${amountIn}&reverse=${reverse}`,
      { signal }
    );
    return data;
  }, []); 

  const getPoolByTokenPair = useCallback(async (tokenA: string, tokenB: string, signal?: AbortSignal) => {
    const res = await api.get(`/swap-pools/${tokenA}/${tokenB}`, { signal });
    return res.data?.[0] || null;
  }, []);

  const getPoolByAddress = useCallback(async (address: string) => {
    const res = await api.get(`/swap-pools/${address}`);
    return res.data || null;
  }, []);

  const swap = useCallback(async (data: {
    poolAddress: string;
    isAToB: boolean;
    amountIn: string;
    minAmountOut: string;
  }) => {
    const res = await api.post("/swap", data);
    return res.data;
  }, []);

  const fetchPools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/swap-pools');
      return res.data || [];
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch LP tokens');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const addLiquidity = useCallback(async (data: {
    poolAddress: string;
    tokenBAmount: string;
    maxTokenAAmount: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.post(`/swap-pools/${data.poolAddress}/liquidity`, {
        tokenBAmount: data.tokenBAmount,
        maxTokenAAmount: data.maxTokenAAmount
      });
      return response.data;
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to add liquidity');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const removeLiquidity = useCallback(async (data: {
    poolAddress: string;
    lpTokenAmount: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.delete(`/swap-pools/${data.poolAddress}/liquidity`, {
        data: { lpTokenAmount: data.lpTokenAmount }
      });
      return response.data;
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to remove liquidity');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTokenBalances = useCallback(async (pool: LiquidityPool, userAddress: string, usdstAddress: string) => {
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

  const getTokenBalance = useCallback(async (tokenAddress: string) => {
    const res = await api.get(`/tokens/balance?address=eq.${tokenAddress}`);
    return res.data[0]?.balance || "0";
  }, []);

  const fetchLpTokensPositions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/swap-pools/positions')
      setLpTokens(res?.data || [])
    } finally {
      setLoading(false)
    }
  },[]);

  const enrichPools = useCallback((pools: LiquidityPool[]) => {
    return pools.map((pool: LiquidityPool) => ({
      ...pool,
      _name: `${pool.tokenA._name}/${pool.tokenB._name}`,
      _symbol: `${pool.tokenA._symbol}/${pool.tokenB._symbol}`,
    }));
  }, []);

 const fetchSwapHistory = useCallback(async (poolAddress: string, params?: Record<string, string>): Promise<{ data: SwapHistoryEntry[]; totalCount: number }> => {
  if (!poolAddress) return { data: [], totalCount: 0 };

    // Fetch swap history with total count from the updated backend service
  const response = await api.get(`/swap-history/${poolAddress}`, { params });

    // Convert timestamp strings back to Date objects
  const data = response.data.data.map((item: SwapHistoryEntry & { timestamp: string }) => ({
    ...item,
    timestamp: new Date(item.timestamp)
  }));

  return { data, totalCount: response.data.totalCount };
}, []);

const refreshSwapHistory = useCallback(
  async (params?: Record<string, string>) => {
    if (!pool?.address) return;
    try {
      const { data, totalCount } = await fetchSwapHistory(pool.address, params);
      setSwapHistory(data);               // ✅ Set new history
      setSwapHistoryCount(totalCount);   // ✅ Set new count
    } catch (err) {
      console.error("Failed to refresh swap history", err);
      setSwapHistory([]);                // Optional fallback
      setSwapHistoryCount(0);            // Optional fallback
    }
  },
  [pool?.address, fetchSwapHistory]
);

  const setPoolRates = useCallback(async (data: SetPoolRatesData) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.post('/swap-pools/set-rates', data);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to update pool rates');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSwappableTokens();
    fetchFees();
  }, [fetchSwappableTokens, fetchFees]);

  return (
    <SwapContext.Provider
      value={{
        swappableTokens,
        pairableTokens,
        loading,
        error,
        // Current swap state
        fromAsset,
        toAsset,
        pool,
        setFromAsset,
        setToAsset,
        setPool,
        // Fee data
        swapFeeRate,
        swapFeeRatePercent,
        feesLoading,
        feesError,
        // Functions
        refetchSwappableTokens: fetchSwappableTokens,
        fetchPairableTokens,
        createPool,
        calculateSwap,
        getPoolByTokenPair,
        getPoolByAddress,
        swap,
        fetchPools,
        addLiquidity,
        removeLiquidity,
        fetchTokenBalances,
        getTokenBalance,
        enrichPools,
        lpTokens,
        fetchLpTokensPositions,
        fetchSwapHistory,
        refreshSwapHistory,
        swapHistory,
        swapHistoryCount,
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
