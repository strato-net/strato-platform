// src/context/UserTokensContext.tsx
import React, { createContext, useContext, useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, axios } from "@/lib/axios";
import { Token } from "@/interface";
import { sUsdstAddress, mUsdstAddress, cataAddress } from "@/lib/constants";
import { useUser } from "@/context/UserContext";
import {
  USER_TOKEN_BALANCES_QUERY_KEY,
  fetchUserTokenBalances,
} from "@/queries/tokenBalancesQuery";

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
  const queryClient = useQueryClient();
  const [allActiveTokens, setAllActiveTokens] = useState<Token[]>([]);
  const [allActiveLoading, setAllActiveLoading] = useState(false);
  const [refetchError, setRefetchError] = useState<string | null>(null);

  const {
    data: balanceData,
    isPending,
    isFetching,
    isError,
    error: balanceQueryError,
  } = useQuery({
    queryKey: USER_TOKEN_BALANCES_QUERY_KEY,
    queryFn: ({ signal }) => fetchUserTokenBalances(signal),
    enabled: isLoggedIn,
    staleTime: 45_000,
  });

  const activeTokens = useMemo(() => {
    if (!isLoggedIn) return [] as Token[];
    const allTokens = balanceData ?? [];
    return allTokens.filter(
      (token: Token) =>
        token.token.status === "2" &&
        token.address !== mUsdstAddress &&
        token.address !== sUsdstAddress &&
        token.address !== cataAddress
    );
  }, [isLoggedIn, balanceData]);

  const inactiveTokens = useMemo(() => {
    if (!isLoggedIn) return [] as Token[];
    const allTokens = balanceData ?? [];
    return allTokens.filter(
      (token: Token) =>
        token.token.status !== "2" ||
        token.address === mUsdstAddress ||
        token.address === sUsdstAddress ||
        token.address === cataAddress
    );
  }, [isLoggedIn, balanceData]);

  const loading = Boolean(isLoggedIn && (isPending || isFetching));

  const queryErrorMessage =
    isError && balanceQueryError
      ? balanceQueryError instanceof Error
        ? balanceQueryError.message
        : "Failed to load tokens"
      : null;

  const fetchTokens = useCallback(
    async (signal?: AbortSignal) => {
      if (!isLoggedIn) return;
      if (signal?.aborted) return;
      setRefetchError(null);
      try {
        await queryClient.refetchQueries({
          queryKey: USER_TOKEN_BALANCES_QUERY_KEY,
        });
      } catch (err) {
        if (
          axios.isCancel?.(err) ||
          (err as { name?: string })?.name === "AbortError" ||
          (err as { code?: string })?.code === "ERR_CANCELED"
        ) {
          return;
        }
        setRefetchError(err instanceof Error ? err.message : "Failed to refresh tokens");
      }
    },
    [isLoggedIn, queryClient]
  );

  const fetchAllActiveTokens = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setAllActiveLoading(true);
    setRefetchError(null);
    try {
      const response = await api.get(`/tokens?status=eq.2`, { signal });
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
      error: refetchError ?? queryErrorMessage,
      fetchTokens,
      fetchAllActiveTokens,
    }),
    [
      activeTokens,
      inactiveTokens,
      allActiveTokens,
      loading,
      allActiveLoading,
      refetchError,
      queryErrorMessage,
      fetchTokens,
      fetchAllActiveTokens,
    ]
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
