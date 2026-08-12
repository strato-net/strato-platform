import { api } from "@/lib/axios";
import type { BridgeToken, NetworkConfig } from "@strato/shared-types";

export const normBridgeAddr = (a: string) => (a || "").toLowerCase().replace(/^0x/, "");

/** Fund page deep-link: Bridge In with a STRATO receive token pre-selected */
export function buildFundBuyPath(tokenAddress: string): string {
  return `/dashboard/deposits?token=${normBridgeAddr(tokenAddress)}`;
}

/**
 * STRATO tokens that appear as Bridge In receive routes (enabled, active).
 * Same endpoints the Fund page uses — Buy only where a bridge route exists.
 */
export async function fetchBridgeBuyableAddresses(): Promise<Set<string>> {
  const { data: configs } = await api.get<NetworkConfig[]>("/bridge/networkConfigs");
  const enabled = (configs || []).filter((cfg) => cfg?.chainInfo?.enabled);

  const perChain = await Promise.all(
    enabled.map((cfg) =>
      api
        .get<BridgeToken[]>(`/bridge/bridgeableTokens/${cfg.externalChainId}`)
        .then((res) => (Array.isArray(res.data) ? res.data : []))
        .catch(() => [] as BridgeToken[])
    )
  );

  const set = new Set<string>();
  for (const tokens of perChain) {
    for (const token of tokens) {
      if (token.stratoToken) set.add(normBridgeAddr(token.stratoToken));
    }
  }
  return set;
}
