import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { api } from "@/lib/axios";

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
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getPrice = useCallback((assetAddress: string): string | null => {
    return prices[assetAddress.toLowerCase()] || null;
  }, [prices]);

  const fetchPrice = useCallback(async (assetAddress: string): Promise<string | null> => {
    if (!assetAddress) return null;
    
    setLoading(true);
    setError(null);
    
    try {
      console.log(`Fetching oracle price for asset: ${assetAddress}`);
      const response = await api.get(`/oracle/price?asset=${assetAddress}`);
      const oraclePrice = response.data;
      console.log(`Oracle price response for ${assetAddress}:`, oraclePrice);
      console.log(`Raw price value: ${oraclePrice.price}, type: ${typeof oraclePrice.price}`);
      
      if (oraclePrice && oraclePrice.price) {
        setPrices(prev => ({
          ...prev,
          [assetAddress.toLowerCase()]: oraclePrice.price
        }));
        return oraclePrice.price;
      }
      
      return null;
    } catch (error) {
      // Handle 500 errors which likely mean the asset price is not found
      const axiosError = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
      if (axiosError.response?.status === 500 && axiosError.response?.data?.message?.includes('Price not found')) {
        console.warn(`Oracle price not found for asset ${assetAddress}`);
        return null;
      }
      
      console.error(`Error fetching oracle price for ${assetAddress}:`, error);
      setError(axiosError.response?.data?.message || axiosError.message || 'Failed to fetch oracle price');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAllPrices = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('Fetching all oracle prices...');
      const response = await api.get('/oracle/price');
      const allPrices = response.data;
      console.log('All oracle prices response:', allPrices);
      
      if (Array.isArray(allPrices)) {
        const priceMap = allPrices.reduce((acc: Record<string, string>, item: OraclePrice) => {
          if (item.asset && item.price) {
            acc[item.asset.toLowerCase()] = item.price;
          }
          return acc;
        }, {});
        
        setPrices(priceMap);
        console.log('Processed price map:', priceMap);
      }
    } catch (error) {
      console.error('Error fetching all oracle prices:', error);
      const axiosError = error as { response?: { data?: { message?: string } }; message?: string };
      setError(axiosError.response?.data?.message || axiosError.message || 'Failed to fetch oracle prices');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPrices = useCallback(async (): Promise<void> => {
    await fetchAllPrices();
  }, [fetchAllPrices]);

  // Fetch all prices on context initialization
  useEffect(() => {
    fetchAllPrices();
  }, [fetchAllPrices]);

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