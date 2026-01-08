import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import { api } from '@/lib/axios';
import { useUser } from "@/context/UserContext";
import { CollateralData } from '@/interface';


export interface LiquidationEntry {
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
  maxRepay?: string;
  collaterals: CollateralData[];
}

type LiquidationContextType = {
  liquidatable: LiquidationEntry[];
  watchlist: LiquidationEntry[];
  loading: boolean;
  error: string | null;
  fetchLiquidatable: (signal?: AbortSignal) => Promise<void>;
  fetchWatchlist: (signal?: AbortSignal) => Promise<void>;
  executeLiquidation: (id: string, collateralAsset?: string, repayAmount?: string, minCollateralOut?: string) => Promise<any>;
  refreshData: () => Promise<void>;
};

const LiquidationContext = createContext<LiquidationContextType | undefined>(undefined);

export const LiquidationProvider = ({ children }: { children: ReactNode }) => {
  const [liquidatable, setLiquidatable] = useState<LiquidationEntry[]>([]);
  const [watchlist, setWatchlist] = useState<LiquidationEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isLoggedIn } = useUser();

  const fetchLiquidatable = useCallback(async (signal?: AbortSignal) => {
    if (!isLoggedIn) {
      setLiquidatable([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<LiquidationEntry[]>('/lend/liquidate', { signal });
      setLiquidatable(res.data || []);
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      setError(err.response?.data?.message || err.message || 'Failed to fetch liquidatable loans');
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  const fetchWatchlist = useCallback(async (signal?: AbortSignal) => {
    if (!isLoggedIn) {
      setWatchlist([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<LiquidationEntry[]>('/lend/liquidate/near-unhealthy?margin=0.2', { signal });
      setWatchlist(res.data || []);
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      setError(err.response?.data?.message || err.message || 'Failed to fetch watchlist loans');
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  const refreshData = useCallback(async () => {
    await Promise.all([
      fetchLiquidatable(),
      fetchWatchlist(),
    ]);
  }, [fetchLiquidatable, fetchWatchlist]);

  const executeLiquidation = useCallback(async (id: string, collateralAsset?: string, repayAmount?: string, minCollateralOut?: string) => {
    setLoading(true);
    setError(null);
    try {
      let response;
      if (collateralAsset && repayAmount) {
        // Extended liquidation with specific collateral and amount
        response = await api.post(`/lend/liquidate/${id}`, {
          collateralAsset,
          repayAmount,
          minCollateralOut: minCollateralOut || "0",
        });
      } else {
        // Simple liquidation (existing behavior)
        response = await api.post(`/lend/liquidate/${id}`);
      }
      
      // Only refresh data if the transaction was successful
      if (response.data && response.data.status && response.data.status.toLowerCase() === 'success') {
        await refreshData();
      }
      
      return response.data;
    } catch (err) {
      // Re-throw the error so the component can handle it
      // The global axios interceptor will show the error toast
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refreshData]);

  useEffect(() => {
    if (isLoggedIn) {
      refreshData();
    }
  }, [refreshData, isLoggedIn]);

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