// src/context/UserTokensContext.tsx
import React, { createContext, useContext, useState, useMemo, useCallback } from "react";
import { api, axios } from "@/lib/axios";
import { Token } from "@/interface";
import isEqual from "lodash.isequal";
import { usdstAddress, sUsdstAddress, mUsdstAddress, cataAddress } from "@/lib/constants";

type UserTokensContextType = {
  activeTokens: Token[];
  inactiveTokens: Token[];
  allActiveTokens: Token[];
  loading: boolean;
  allActiveLoading: boolean;
  error: string | null;
  allActivePagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
  fetchTokens: (signal?: AbortSignal) => Promise<void>;
  fetchAllActiveTokens: (page?: number, limit?: number, signal?: AbortSignal) => Promise<void>;
  
  // USDST balance
  usdstBalance: string;
  loadingUsdstBalance: boolean;
  fetchUsdstBalance: (userAddress: string, signal?: AbortSignal) => Promise<void>;
  voucherBalance: string;
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
  const [allActivePagination, setAllActivePagination] = useState({
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 0,
    hasNext: false,
    hasPrevious: false,
  });
  
  // USDST balance state
  const [usdstBalance, setUsdstBalance] = useState("0");
  const [voucherBalance, setVoucherBalance] = useState("0");
  const [loadingUsdstBalance, setLoadingUsdstBalance] = useState(false);

  const fetchUsdstBalance = useCallback(async (userAddress: string, signal?: AbortSignal) => {
    if (!userAddress) return;
    
    setLoadingUsdstBalance(true);
    try {
      const [usdstResponse, voucherResponse] = await Promise.all([
        api.get(`/tokens/balance`, {
          signal,
          params: { address: `eq.${usdstAddress}` },
        }),
        api.get(`/vouchers/balance`, {
          signal,
        }),
      ]);

      if (signal?.aborted) return;

      setUsdstBalance(usdstResponse?.data?.[0]?.balance || "0");
      setVoucherBalance(voucherResponse?.data?.balance || "0");
    } catch (err) {
      if (signal?.aborted) return;
      setUsdstBalance("0");
      setVoucherBalance("0");
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

      const active = allTokens.filter((token: Token) =>
        // filtering musdst, sUSDST, and CATA tokens out
        token.token.status === '2' &&
        token.address !== mUsdstAddress &&
        token.address !== sUsdstAddress &&
        token.address !== cataAddress
      );
      const inactive = allTokens.filter((token: Token) =>
        token.token.status !== '2' ||
        token.address === mUsdstAddress ||
        token.address === sUsdstAddress ||
        token.address === cataAddress
      );

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
  const fetchAllActiveTokens = useCallback(async (page = 1, limit = 10, signal?: AbortSignal): Promise<void> => {
    setAllActiveLoading(true);
    setError(null);
    try {
      const offset = (page - 1) * limit;
      const params = {
        status: 'eq.2',
        limit: limit.toString(),
        offset: offset.toString(),
      };
      const response = await api.get(`/tokens`, { signal, params });
      // Only update state if not aborted and data has actually changed
      if (signal?.aborted) return;
      const tokens = response.data.data || [];
      setAllActiveTokens(tokens);
      setAllActivePagination(response.data.pagination || {
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
        hasNext: false,
        hasPrevious: false,
      });
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
      allActivePagination,
      fetchTokens,
      fetchAllActiveTokens,
      
      // USDST balance
      usdstBalance,
      loadingUsdstBalance,
      voucherBalance,
      fetchUsdstBalance,
    }),
    [activeTokens, inactiveTokens, allActiveTokens, loading, allActiveLoading, error, allActivePagination, fetchTokens, fetchAllActiveTokens, usdstBalance, voucherBalance, loadingUsdstBalance, fetchUsdstBalance]
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
