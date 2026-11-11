import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { useUserTokens } from "@/context/UserTokensContext";
import {
  CandleResolution,
  Market,
  MarketCandle,
  MarketStats,
  MarketTrade,
  PoolV3LiquidityDistribution,
} from "@/interface";

const FAST_POLL_MS = 3_000;
const SLOW_POLL_MS = 15_000;

/** Terminal markets (tokens, pool balances, whether trading is open). */
export function useMarkets() {
  return useQuery({
    queryKey: ["trade", "markets"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<Market[]>("/trade/markets", { signal });
      return data ?? [];
    },
    refetchInterval: SLOW_POLL_MS,
    retry: 1,
  });
}

export function useMarketStats(poolAddress?: string) {
  return useQuery({
    queryKey: ["trade", "market", poolAddress, "stats"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<MarketStats>(`/trade/markets/${poolAddress}/stats`, { signal });
      return data;
    },
    enabled: !!poolAddress,
    refetchInterval: FAST_POLL_MS,
    retry: 1,
  });
}

export function useMarketTrades(poolAddress?: string) {
  return useQuery({
    queryKey: ["trade", "market", poolAddress, "trades"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<MarketTrade[]>(`/trade/markets/${poolAddress}/trades`, {
        params: { limit: 60 },
        signal,
      });
      return data ?? [];
    },
    enabled: !!poolAddress,
    refetchInterval: FAST_POLL_MS,
    retry: 1,
  });
}

/**
 * Candles for one resolution. The first fetch loads the history; each poll then asks
 * only for buckets from the newest one on and merges them over the cached series.
 */
export function useMarketCandles(poolAddress: string | undefined, resolution: CandleResolution) {
  return useQuery({
    queryKey: ["trade", "market", poolAddress, "candles", resolution],
    queryFn: async ({ signal, client, queryKey }) => {
      const cached = client.getQueryData<MarketCandle[]>(queryKey) ?? [];
      const from = cached.length > 0 ? cached[cached.length - 1][0] : undefined;
      const { data } = await api.get<MarketCandle[]>(`/trade/markets/${poolAddress}/candles`, {
        params: { resolution, ...(from ? { from } : {}) },
        signal,
      });
      const fresh = data ?? [];
      // a poll resumed after a long pause returns only the newest buckets: start over from those
      if (!from || fresh.length === 0 || fresh[0][0] > from) return fresh.length > 0 ? fresh : cached;
      return [...cached.filter((c) => c[0] < fresh[0][0]), ...fresh];
    },
    enabled: !!poolAddress,
    refetchInterval: FAST_POLL_MS,
    retry: 1,
  });
}

/** Active liquidity per tick interval — the depth ladder's input. */
export function useMarketLiquidity(poolAddress?: string) {
  return useQuery({
    queryKey: ["trade", "market", poolAddress, "liquidity"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<PoolV3LiquidityDistribution>(`/poolv3/pools/${poolAddress}/liquidity`, { signal });
      return data;
    },
    enabled: !!poolAddress,
    refetchInterval: 5_000,
    retry: 1,
  });
}

/** The signed-in user's wallet balances of the market's two tokens, wei strings. */
export function useMarketBalances(market: Market): { base: string; quote: string } {
  const { activeTokens, inactiveTokens } = useUserTokens();
  const balanceOf = (address: string): string =>
    [...activeTokens, ...inactiveTokens].find((t) => t.address === address)?.balance || "0";
  return { base: balanceOf(market.base.address), quote: balanceOf(market.quote.address) };
}
