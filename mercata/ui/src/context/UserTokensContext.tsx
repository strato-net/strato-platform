// src/context/UserTokensContext.tsx
import React, { createContext, useContext, useState, useMemo, useCallback } from "react";
import { api, axios } from "@/lib/axios";
import { Token } from "@/interface";
import isEqual from "lodash.isequal";
import { usdstAddress } from "@/lib/contants";

type UserTokensContextType = {
  activeTokens: Token[];
  inactiveTokens: Token[];
  allActiveTokens: Token[];
  loading: boolean;
  allActiveLoading: boolean;
  error: string | null;
  fetchTokens: (signal?: AbortSignal) => Promise<void>;
  fetchAllActiveTokens: (signal?: AbortSignal) => Promise<void>;
  
  // USDST balance
  usdstBalance: string;
  loadingUsdstBalance: boolean;
  fetchUsdstBalance: (userAddress: string, signal?: AbortSignal) => Promise<void>;
};

const UserTokensContext = createContext<UserTokensContextType | undefined>(
  undefined
);

export const UserTokensProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [activeTokens, setActiveTokens] = useState<Token[]>([]);
  const [inactiveTokens, setInactiveTokens] = useState<Token[]>([]);
  const [allActiveTokens, setAllActiveTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const [allActiveLoading, setAllActiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // USDST balance state
  const [usdstBalance, setUsdstBalance] = useState("0");
  const [loadingUsdstBalance, setLoadingUsdstBalance] = useState(false);

  const fetchUsdstBalance = useCallback(async (userAddress: string, signal?: AbortSignal) => {
    if (!userAddress) return;
    
    setLoadingUsdstBalance(true);
    try {
      const res = await api.get(
        `/tokens/balance?address=eq.${usdstAddress}`,
        { signal }
      );
      
      if (signal?.aborted) return;
      
      setUsdstBalance(res?.data?.[0]?.balance || "0");
    } catch (err) {
      return;
    } finally {
      if (!signal?.aborted) {
        setLoadingUsdstBalance(false);
      }
    }
  }, []);

  const fetchTokens = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(
        `/tokens/balance`,
        { signal }
      );
      // Only update state if not aborted and data has actually changed
      if (signal?.aborted) return;

      const allTokens = response.data || [];
  
      const active = allTokens.filter((token: Token) => token.token.status === '2');
      const inactive = allTokens.filter((token: Token) => token.token.status !== '2');

      setActiveTokens(prev => (isEqual(prev, active) ? prev : active));
      setInactiveTokens(prev => (isEqual(prev, inactive) ? prev : inactive));
    } catch (err) {
      if (
        axios.isCancel?.(err) ||
        err?.name === "CanceledError" ||
        err?.code === "ERR_CANCELED" ||
        err?.message === "canceled"
      ) {
        return;
      }
      setActiveTokens([]);
      setInactiveTokens([]);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  // Modified to work like fetchTokens - storing in state
  const fetchAllActiveTokens = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setAllActiveLoading(true);
    setError(null);
    try {
      const response = await api.get(`/tokens?status=eq.2`, { signal });
      // Only update state if not aborted and data has actually changed
      if (signal?.aborted) return;
      const tokens = response.data || [];
      setAllActiveTokens(tokens);
    } catch (err) {
      if (
        axios.isCancel?.(err) ||
        err?.name === "CanceledError" ||
        err?.code === "ERR_CANCELED" ||
        err?.message === "canceled"
      ) {
        return;
      }
      setAllActiveTokens([]);
    } finally {
      if (!signal?.aborted) {
        setAllActiveLoading(false);
      }
    }
  }, []);

  const contextValue = useMemo(
    () => ({
      activeTokens,
      inactiveTokens,
      allActiveTokens,
      loading,
      allActiveLoading,
      error,
      fetchTokens,
      fetchAllActiveTokens,
      
      // USDST balance
      usdstBalance,
      loadingUsdstBalance,
      fetchUsdstBalance,
    }),
    [activeTokens, inactiveTokens, allActiveTokens, loading, allActiveLoading, error, fetchTokens, fetchAllActiveTokens, usdstBalance, loadingUsdstBalance, fetchUsdstBalance]
  );

  return (
    <UserTokensContext.Provider value={contextValue}>
      {children}
    </UserTokensContext.Provider>
  );
};

export const useUserTokens = () => {
  const context = useContext(UserTokensContext);
  if (!context) {
    throw new Error("useUserTokens must be used within a UserTokensProvider");
  }
  return context;
};
