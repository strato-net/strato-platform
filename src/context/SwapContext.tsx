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
