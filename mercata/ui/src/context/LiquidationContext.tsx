import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import { api } from '@/lib/axios';

interface LiquidationEntry {
  id: string;
  user: string;
  asset: string;
  assetSymbol?: string;
  amount: string;
  collateralAsset: string;
  collateralSymbol?: string;
  collateralAmount: string;
  healthFactor: number;
  expectedProfit?: string;
}

type LiquidationContextType = {
  liquidatable: LiquidationEntry[];
  watchlist: LiquidationEntry[];
  loading: boolean;
  error: string | null;
  fetchLiquidatable: (signal?: AbortSignal) => Promise<void>;
  fetchWatchlist: (signal?: AbortSignal) => Promise<void>;
  executeLiquidation: (id: string) => Promise<void>;
  refreshData: () => Promise<void>;
};

const LiquidationContext = createContext<LiquidationContextType | undefined>(undefined);

export const LiquidationProvider = ({ children }: { children: ReactNode }) => {
  const [liquidatable, setLiquidatable] = useState<LiquidationEntry[]>([]);
  const [watchlist, setWatchlist] = useState<LiquidationEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLiquidatable = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<LiquidationEntry[]>('/lend/liquidate', { signal });
      setLiquidatable(res.data || []);
    } catch (err: any) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      console.error('Error fetching liquidatable loans:', err);
      setError(err.response?.data?.message || err.message || 'Failed to fetch liquidatable loans');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWatchlist = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<LiquidationEntry[]>('/lend/liquidate/near-unhealthy?margin=0.2', { signal });
      setWatchlist(res.data || []);
    } catch (err: any) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      console.error('Error fetching watchlist loans:', err);
      setError(err.response?.data?.message || err.message || 'Failed to fetch watchlist loans');
    } finally {
      setLoading(false);
    }
  }, []);

  const executeLiquidation = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/lend/liquidate/${id}`);
      // Refresh data after successful liquidation
      await refreshData();
    } catch (err: any) {
      console.error('Liquidation failed:', err);
      setError(err.response?.data?.message || err.message || 'Error executing liquidation');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshData = useCallback(async () => {
    try {
      await Promise.all([
        fetchLiquidatable(),
        fetchWatchlist(),
      ]);
    } catch (err: any) {
      console.error('Error refreshing liquidation data:', err);
    }
  }, [fetchLiquidatable, fetchWatchlist]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  return (
    <LiquidationContext.Provider
      value={{
        liquidatable,
        watchlist,
        loading,
        error,
        fetchLiquidatable,
        fetchWatchlist,
        executeLiquidation,
        refreshData,
      }}
    >
      {children}
    </LiquidationContext.Provider>
  );
};

export const useLiquidationContext = (): LiquidationContextType => {
  const context = useContext(LiquidationContext);
  if (!context) throw new Error('useLiquidationContext must be used within a LiquidationProvider');
  return context;
}; 