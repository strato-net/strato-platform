import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { SwappableToken } from '@/interface';
import {api} from '@/lib/axios';

type SwapContextType = {
  swappableTokens: SwappableToken[];
  pairableTokens: SwappableToken[];
  loading: boolean;
  error: string | null;
  refetchSwappableTokens: () => void;
  fetchPairableTokens: (tokenAddress: string) => void;
  createPool: (data: { tokenA: string; tokenB: string }) => Promise<void>;
  calculateSwap: (params: {
    poolAddress: string;
    direction: boolean;
    amount: string;
    signal?: AbortSignal;
  }) => Promise<string>;
  calculateSwapReverse: (params: {
    poolAddress: string;
    direction: boolean;
    amount: string;
    signal?: AbortSignal;
  }) => Promise<string>;
  getPoolByTokenPair: (tokenA: string, tokenB: string) => Promise<any>;
  getPoolByAddress: (address: string) => Promise<any>;
  swap: (data: {
    address: string;
    method: "tokenAToTokenB" | "tokenBToTokenA";
    amount: string;
    min_tokens: string;
  }) => Promise<any>;
  fetchPools: () => Promise<any[]>;
  addLiquidity: (data: {
    address: string;
    max_tokenA_amount: string;
    tokenB_amount: string;
  }) => Promise<any>;
  removeLiquidity: (data: {
    address: string;
    amount: string;
  }) => Promise<any>;
};

const SwapContext = createContext<SwapContextType | undefined>(undefined);

export const SwapProvider = ({ children }: { children: ReactNode }) => {
  const [swappableTokens, setSwappableTokens] = useState<SwappableToken[]>([]);
  const [pairableTokens, setPairableTokens] = useState<SwappableToken[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSwappableTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<SwappableToken[]>('/swap/swappableTokens');
      setSwappableTokens(res.data || []);
    } catch (err: any) {
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
      const res = await api.get<SwappableToken[]>(`/swap/swappableTokenPairs/${tokenAddress}`);
      setPairableTokens(res.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch pairable tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  const createPool = useCallback(async (data: { tokenA: string; tokenB: string }) => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/swap', data);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create pool');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const calculateSwap = useCallback(async ({
    poolAddress,
    direction,
    amount,
    signal
  }: {
    poolAddress: string;
    direction: boolean;
    amount: string;
    signal?: AbortSignal;
  }) => {
    try {
      const { data } = await api.get(
        `/swap/calculateSwap?address=${poolAddress}&direction=${direction}&amount=${amount}`,
        { signal }
      );
      return data;
    } catch (err: any) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') throw err;
      throw new Error(err.response?.data?.message || err.message || 'Failed to calculate swap');
    }
  }, []);

  const calculateSwapReverse = useCallback(async ({
    poolAddress,
    direction,
    amount,
    signal
  }: {
    poolAddress: string;
    direction: boolean;
    amount: string;
    signal?: AbortSignal;
  }) => {
    try {
      const { data } = await api.get(
        `/swap/calculateSwapReverse?address=${poolAddress}&direction=${direction}&amount=${amount}`,
        { signal }
      );
      return data;
    } catch (err: any) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') throw err;
      throw new Error(err.response?.data?.message || err.message || 'Failed to calculate swap reverse');
    }
  }, []);

  const getPoolByTokenPair = useCallback(async (tokenA: string, tokenB: string) => {
    try {
      const res = await api.get(`/swap/poolByTokenPair?tokenPair=${tokenA},${tokenB}`);
      return res.data?.[0] || null;
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to get pool');
      return null;
    }
  }, []);

  const getPoolByAddress = useCallback(async (address: string) => {
    try {
      const res = await api.get(`/swap/${address}`);
      return res.data || null;
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to get pool');
      return null;
    }
  }, []);

  const swap = useCallback(async (data: {
    address: string;
    method: "tokenAToTokenB" | "tokenBToTokenA";
    amount: string;
    min_tokens: string;
  }) => {
    try {
      const res = await api.post("/swap/swap", data);
      return res.data;
    } catch (err: any) {
      throw new Error(err.response?.data?.message || err.message || "Swap transaction failed");
    }
  }, []);

  const fetchPools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/swap');
      return res.data || [];
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch LP tokens');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const addLiquidity = useCallback(async (data: {
    address: string;
    max_tokenA_amount: string;
    tokenB_amount: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.post("/swap/addLiquidity", data);
      return response.data;
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to add liquidity');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const removeLiquidity = useCallback(async (data: {
    address: string;
    amount: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.post("/swap/removeLiquidity", data);
      return response.data;
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to remove liquidity');
      throw err;
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
        error,
        refetchSwappableTokens: fetchSwappableTokens,
        fetchPairableTokens,
        createPool,
        calculateSwap,
        calculateSwapReverse,
        getPoolByTokenPair,
        getPoolByAddress,
        swap,
        fetchPools,
        addLiquidity,
        removeLiquidity,
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
