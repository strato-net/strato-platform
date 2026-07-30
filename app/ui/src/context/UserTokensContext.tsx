// src/context/UserTokensContext.tsx
import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from "react";
import { api, axios } from "@/lib/axios";
import { Token } from "@/interface";
import isEqual from "lodash.isequal";
import { sUsdstAddress, mUsdstAddress, cataAddress } from "@/lib/constants";
import { useUser } from "@/context/UserContext";

type UserTokensContextType = {
  activeTokens: Token[];
  inactiveTokens: Token[];
  allActiveTokens: Token[];
  loading: boolean;
  allActiveLoading: boolean;
  error: string | null;
  fetchTokens: (signal?: AbortSignal) => Promise<void>;
  fetchAllActiveTokens: (signal?: AbortSignal) => Promise<void>;
};

const UserTokensContext = createContext<UserTokensContextType | undefined>(
  undefined
);

export const UserTokensProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const { isLoggedIn } = useUser();
  const [activeTokens, setActiveTokens] = useState<Token[]>([]);
  const [inactiveTokens, setInactiveTokens] = useState<Token[]>([]);
  const [allActiveTokens, setAllActiveTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const [allActiveLoading, setAllActiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Fetch tokens on mount, but only if logged in
  useEffect(() => {
    if (!isLoggedIn) return;
    const abortController = new AbortController();
    fetchTokens(abortController.signal);
    return () => abortController.abort();
  }, [fetchTokens, isLoggedIn]);

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
    }),
    [activeTokens, inactiveTokens, allActiveTokens, loading, allActiveLoading, error, fetchTokens, fetchAllActiveTokens]
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
