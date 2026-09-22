import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/axios";
import { SwapToken } from "@/interface";
import type { BridgeToken, NetworkConfig } from "@strato/shared-types";
import type { NetworkSummary } from "@/lib/bridge/types";

const TRADE_NETWORK_NAMES: Record<string, string> = {
  "1": "Ethereum Mainnet",
  "11155111": "Ethereum Sepolia",
  "8453": "Base",
  "84532": "Base Sepolia",
  "59144": "Linea",
  "59141": "Linea Sepolia",
};

/** All tokens tradable on any pool (V2, stable, or V3). */
export function useTradeTokens() {
  return useQuery({
    queryKey: ["trade", "tokens"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<SwapToken[]>("/trade/tokens", { signal });
      return data ?? [];
    },
    staleTime: 30_000,
    retry: 1,
  });
}

/** Every asset that can be reached through TokenRouter. */
export function useRouteAssets() {
  return useQuery({
    queryKey: ["trade", "route", "assets"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<SwapToken[]>("/trade/route/assets", {
        signal,
      });
      return data ?? [];
    },
    staleTime: 30_000,
    retry: 1,
  });
}

export type TradeBridgeCatalog = {
  availableNetworks: NetworkSummary[];
  bridgeableTokens: BridgeToken[];
  selectedNetwork: string | null;
  setSelectedNetwork: (networkName: string) => void;
  loading: boolean;
};

export function useTradeBridgeCatalog(): TradeBridgeCatalog {
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
  const networksQuery = useQuery({
    queryKey: ["trade", "external", "networks"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<NetworkConfig[]>("/bridge/networkConfigs", {
        signal,
      });
      return (data || [])
        .filter((config) => config?.chainInfo?.enabled)
        .map((config): NetworkSummary => ({
          chainId: config.externalChainId.toString(),
          chainName:
            TRADE_NETWORK_NAMES[config.externalChainId.toString()] ||
            config.chainInfo.chainName,
          enabled: config.chainInfo.enabled,
          depositRouter: config.chainInfo.depositRouter,
        }))
        .sort((a, b) => a.chainId.localeCompare(b.chainId));
    },
    staleTime: 30_000,
    retry: 1,
  });
  const availableNetworks = networksQuery.data ?? [];
  const activeNetwork =
    availableNetworks.find((network) => network.chainName === selectedNetwork) ??
    availableNetworks[0];
  const tokensQuery = useQuery({
    queryKey: ["trade", "external", "tokens", activeNetwork?.chainId],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<BridgeToken[]>(
        `/bridge/bridgeableTokens/${activeNetwork!.chainId}`,
        { signal }
      );
      return Array.isArray(data) ? data : [];
    },
    enabled: !!activeNetwork,
    staleTime: 30_000,
    retry: 1,
  });
  const bridgeableTokens = useMemo(
    () => tokensQuery.data ?? [],
    [tokensQuery.data]
  );

  return {
    availableNetworks,
    bridgeableTokens,
    selectedNetwork: activeNetwork?.chainName ?? null,
    setSelectedNetwork,
    loading: networksQuery.isLoading || tokensQuery.isLoading,
  };
}

/** Tokens tradable against the given token. */
export function useTradePairableTokens(tokenAddress?: string) {
  return useQuery({
    queryKey: ["trade", "tokens", tokenAddress, "pairs"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<SwapToken[]>(`/trade/tokens/${tokenAddress}/pairs`, { signal });
      return data ?? [];
    },
    enabled: !!tokenAddress,
    // keep the previous token's list rendered while a new one loads
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 1,
  });
}
