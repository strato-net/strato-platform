import { usdstAddress } from "@/lib/constants";
import { api } from "@/lib/axios";

export const normTradeAddr = (a: string) => (a || "").toLowerCase().replace(/^0x/, "");

/** Trade page deep-link: From = USDST, To = token */
export function buildTradeBuyPath(tokenAddress: string): string {
  return `/dashboard/swap?from=${normTradeAddr(usdstAddress)}&to=${normTradeAddr(tokenAddress)}`;
}

/**
 * Tokens the Trade page can pair with USDST — same endpoint the swap widget uses,
 * so Buy is only offered where a USDST → token route exists.
 */
export async function fetchUsdstBuyableAddresses(): Promise<Set<string>> {
  const { data } = await api.get<{ address: string }[]>(
    `/trade/tokens/${normTradeAddr(usdstAddress)}/pairs`
  );
  return new Set((data || []).map((token) => normTradeAddr(token.address)));
}
