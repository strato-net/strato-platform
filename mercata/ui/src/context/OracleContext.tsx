import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { api } from "@/lib/axios";
import { useUser } from "@/context/UserContext";

interface OraclePrice {
  asset: string;
  price: string;
}

interface OracleContextType {
  prices: Record<string, string>;
  loading: boolean;
  error: string | null;
  getPrice: (assetAddress: string) => string | null;
  fetchPrice: (assetAddress: string) => Promise<string | null>;
  fetchAllPrices: () => Promise<void>;
  refreshPrices: () => Promise<void>;
}

const OracleContext = createContext<OracleContextType | undefined>(undefined);

export const OracleProvider = ({ children }: { children: ReactNode }) => {
  const { isLoggedIn } = useUser();
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getPrice = useCallback((assetAddress: string): string | null => {
    return prices[assetAddress.toLowerCase()] || null;
  }, [prices]);

  const fetchPrice = useCallback(async (assetAddress: string): Promise<string | null> => {
    if (!assetAddress || !isLoggedIn) return null;
    
    setLoading(true);
    setError(null);
    
          try {
        // Fetch oracle prices directly using the lending/pools endpoint which has access to detailed oracle data
        const response = await api.get(`/lending/pools`, {
          params: {
            select: `priceOracle:priceOracle_fkey(address,prices:BlockApps-PriceOracle-prices(asset:key,price:value::text))`
          }
        });
        
        const registry = response.data;
        const prices = registry?.priceOracle?.prices || [];
        
        const priceEntry = prices.find((p: { asset?: string; price?: string }) => 
          p.asset && p.asset.toLowerCase() === assetAddress.toLowerCase()
        );
        
        if (priceEntry && priceEntry.price) {
          setPrices(prev => ({
            ...prev,
            [assetAddress.toLowerCase()]: priceEntry.price
          }));
          return priceEntry.price;
        }
        
        return null;
          } catch (error) {
        return null;
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  const fetchAllPrices = useCallback(async (): Promise<void> => {
    if (!isLoggedIn) return;
    setLoading(true);
    setError(null);
    
          try {
        const response = await api.get('/oracle/price');
        const allPrices = response.data;
      
      if (Array.isArray(allPrices)) {
        const priceMap = allPrices.reduce((acc: Record<string, string>, item: OraclePrice) => {
          if (item.asset && item.price) {
            acc[item.asset.toLowerCase()] = item.price;
          }
          return acc;
        }, {});
        
        setPrices(priceMap);
      }
          } catch (error) {

    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  const refreshPrices = useCallback(async (): Promise<void> => {
    await fetchAllPrices();
  }, [fetchAllPrices]);

  // Fetch all prices on context initialization, but only if logged in
  useEffect(() => {
    if (isLoggedIn) {
      fetchAllPrices();
    }
  }, [fetchAllPrices, isLoggedIn]);

  const contextValue: OracleContextType = {
    prices,
    loading,
    error,
    getPrice,
    fetchPrice,
    fetchAllPrices,
    refreshPrices,
  };

  return (
    <OracleContext.Provider value={contextValue}>
      {children}
    </OracleContext.Provider>
  );
};

export const useOracleContext = (): OracleContextType => {
  const context = useContext(OracleContext);
  if (!context) {
    throw new Error("useOracleContext must be used within an OracleProvider");
  }
  return context;
}; 