// src/context/UserTokensContext.tsx
import React, { createContext, useContext, useState, useMemo } from "react";
import { api, axios } from "@/lib/axios";
import { Token } from "@/interface";
import isEqual from "lodash.isequal";

type UserTokensContextType = {
  tokens: Token[];
  loading: boolean;
  error: string | null;
  fetchTokens: (userAddress: string, signal?: AbortSignal) => Promise<void>;
};

const UserTokensContext = createContext<UserTokensContextType | undefined>(
  undefined
);

export const UserTokensProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTokens = async (userAddress: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(
        `/tokens/balance?key=eq.${userAddress}`,
        { signal }
      );
      // Only update state if not aborted and data has actually changed
      if (signal?.aborted) return;
      setTokens((prevTokens) => {
        if (isEqual(prevTokens, response.data)) {
          return prevTokens;
        }
        return response.data;
      });
    } catch (err: any) {
      if (
        axios.isCancel?.(err) ||
        err?.name === "CanceledError" ||
        err?.code === "ERR_CANCELED" ||
        err?.message === "canceled"
      ) {
        // Request was aborted, don't update state
        return;
      }
      console.error("Failed to fetch tokens:", err);
      setError("Failed to fetch token data");
      setTokens([]); // Reset to empty array on error
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  const contextValue = useMemo(
    () => ({
      tokens,
      loading,
      error,
      fetchTokens,
    }),
    [tokens, loading, error, fetchTokens]
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
