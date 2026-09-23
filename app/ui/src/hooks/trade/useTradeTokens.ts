import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/axios";
import { SwapToken } from "@/interface";
import type { BridgeToken, NetworkConfig } from "@strato/shared-types";
import { useUser } from "@/context/UserContext";
import { getTokenConfig } from "@/lib/bridge/contractService";
import { metalForgeService } from "@/services/metalForgeService";
import type { NetworkSummary, TradeBridgeCatalog } from "@/lib/bridge/types";
export type { TradeBridgeCatalog } from "@/lib/bridge/types";
import { BRIDGE_SCOPES } from "@/lib/bridge/constants";

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
  const { userAddress, isAppAuthenticated } = useUser();
  return useQuery({
    queryKey: ["trade", "route", "assets", userAddress, isAppAuthenticated],
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

export function useRoutePoolTokens(poolAddress?: string) {
  return useQuery({
    queryKey: ["trade", "route", "pool", poolAddress],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<string[]>(`/trade/route/pool/${poolAddress}`, { signal });
      return data;
    },
    enabled: !!poolAddress,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useTradeBridgeCatalog(): TradeBridgeCatalog {
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
  const networksQuery = useQuery({
    queryKey: ["trade", "external", "networks"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<NetworkConfig[]>(`${BRIDGE_SCOPES.trade.apiBase}/networkConfigs`, {
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
        `${BRIDGE_SCOPES.trade.apiBase}/bridgeableTokens/${activeNetwork!.chainId}`,
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

export function useRouteDepositConfig(network?: NetworkSummary, route?: BridgeToken, enabled = false) {
  const chainId = Number(network?.chainId);
  return useQuery({
    queryKey: ["trade", "deposit-config", network?.chainId, network?.depositRouter, route?.externalToken],
    queryFn: () => getTokenConfig({
      chainId, tokenAddress: route!.externalToken, depositRouterAddress: network!.depositRouter!,
    }),
    enabled: enabled && Number.isSafeInteger(chainId) && chainId > 0 && !!network?.depositRouter && !!route,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useRouteMetals() {
  return useQuery({
    queryKey: ["trade", "metals"],
    queryFn: metalForgeService.getConfigs,
    staleTime: 30_000,
    retry: 1,
  });
}
