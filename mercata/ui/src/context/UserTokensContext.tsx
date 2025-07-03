// src/context/UserTokensContext.tsx
import React, { createContext, useContext, useState, useMemo, useCallback } from "react";
import { api, axios } from "@/lib/axios";
import { Token } from "@/interface";
import isEqual from "lodash.isequal";

type UserTokensContextType = {
  activeTokens: Token[];
  inactiveTokens: Token[];
  loading: boolean;
  error: string | null;
  fetchTokens: (userAddress: string, signal?: AbortSignal) => Promise<void>;
};

const UserTokensContext = createContext<UserTokensContextType | undefined>(
  undefined
);

export const UserTokensProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [activeTokens, setActiveTokens] = useState<Token[]>([]);
  const [inactiveTokens, setInactiveTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTokens = useCallback(async (userAddress: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(
        `/tokens/balance?key=eq.${userAddress}`,
        { signal }
      );
      // Only update state if not aborted and data has actually changed
      if (signal?.aborted) return;

      const allTokens = response.data || [];

      const active = allTokens.filter((token: Token) => token.token.status === '2');
      const inactive = allTokens.filter((token: Token) => token.token.status !== '2');

      setActiveTokens(prev => (isEqual(prev, active) ? prev : active));
      setInactiveTokens(prev => (isEqual(prev, inactive) ? prev : inactive));
    } catch (err: any) {
      if (
        axios.isCancel?.(err) ||
        err?.name === "CanceledError" ||
        err?.code === "ERR_CANCELED" ||
        err?.message === "canceled"
      ) {
        return;
      }
      console.error("Failed to fetch tokens:", err);
      setError("Failed to fetch token data");
      setActiveTokens([]);
      setInactiveTokens([]);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  const contextValue = useMemo(
    () => ({
      activeTokens,
      inactiveTokens,
      loading,
      error,
      fetchTokens,
    }),
    [activeTokens, inactiveTokens, loading, error, fetchTokens]
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
