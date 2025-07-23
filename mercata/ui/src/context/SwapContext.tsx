import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { LiquidityPool, SwappableToken, SwapHistoryEntry } from '@/interface';
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
    try {
      const { data } = await api.get(
        `/swap/quote?poolAddress=${poolAddress}&isAToB=${isAToB}&amountIn=${amountIn}&reverse=${reverse}`,
        { signal }
      );
      return data;
    } catch (err) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') throw err;
      throw new Error(err.response?.data?.message || err.message || 'Failed to calculate swap');
    }
  }, []); 

  const getPoolByTokenPair = useCallback(async (tokenA: string, tokenB: string, signal?: AbortSignal) => {
    try {
      const res = await api.get(`/swap-pools/${tokenA}/${tokenB}`, { signal });
      return res.data?.[0] || null;
    } catch (err) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') throw err;
      setError(err.response?.data?.message || err.message || 'Failed to get pool');
      return null;
    }
  }, []);

  const getPoolByAddress = useCallback(async (address: string) => {
    try {
      const res = await api.get(`/swap-pools/${address}`);
      return res.data || null;
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to get pool');
      return null;
    }
  }, []);

  const swap = useCallback(async (data: {
    poolAddress: string;
    isAToB: boolean;
    amountIn: string;
    minAmountOut: string;
  }) => {
    try {
      const res = await api.post("/swap", data);
      return res.data;
    } catch (err) {
      throw new Error(err.response?.data?.message || err.message || "Swap transaction failed");
    }
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
    try {
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
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch token balances');
      throw err;
    }
  }, []);

  const getTokenBalance = useCallback(async (tokenAddress: string) => {
    try {
      const res = await api.get(`/tokens/balance?address=eq.${tokenAddress}`);
      return res.data[0]?.balance || "0";
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to get token balance');
      throw err;
    }
  }, []);

  const fetchLpTokensPositions = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/swap-pools/positions')
      setLpTokens(res?.data || [])
      setLoading(false)
    } catch (err) {
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
    
    try {
      // Fetch swap history with total count from the updated backend service
      const response = await api.get(`/swap-history/${poolAddress}`, { params });
      
      // Convert timestamp strings back to Date objects
      const data = response.data.data.map((item: any) => ({
        ...item,
        timestamp: new Date(item.timestamp)
      }));
      
      return { data, totalCount: response.data.totalCount };
    } catch (err) {
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
