import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { useTokenContext } from "@/context/TokenContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useTradeHistory } from "@/hooks/trade/useTradeHistory";
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
/** After a trade: how often the tape is checked for it, and the longest balances wait for it */
const SETTLING_POLL_MS = 1_000;
const SETTLING_TIMEOUT_MS = 15_000;
const MY_TRADES_LIMIT = 25;
/** one array for "none", so nothing downstream sees a change where there is none */
const NO_TRADES: never[] = [];

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

export function useMarketTrades(poolAddress?: string, pollMs = FAST_POLL_MS) {
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
    refetchInterval: pollMs,
    retry: 1,
  });
}

/**
 * The signed-in user's own swaps on the market's tape, newest first. A new one appears once
 * a trade of theirs has been indexed. The tape is already polled, so this costs no request.
 */
export function useOwnTrades(poolAddress?: string, pollMs?: number): MarketTrade[] {
  const { userAddress } = useUser();
  const { data: trades = [] } = useMarketTrades(poolAddress, pollMs);
  const ownAddress = userAddress?.toLowerCase().replace(/^0x/, "");
  return trades.filter((trade) => trade.sender === ownAddress);
}

/**
 * The signed-in user's latest trades in the market's pair, newest first; none for a guest.
 * Held by the page: the trades list and the chart's fill markers read the same load.
 */
export function useMyTrades(market?: Market) {
  const { userAddress } = useUser();
  // one refetch at confirmation can land before the indexer has the swap: refetch again
  // when the user's trade shows on the tape
  const revision = useOwnTrades(market?.poolAddress)[0]?.id;
  const { data, isLoading } = useTradeHistory({
    tokenIn: userAddress ? market?.base.address : undefined,
    tokenOut: market?.quote.address,
    page: 1,
    limit: MY_TRADES_LIMIT,
    sender: userAddress ?? undefined,
    revision,
  });
  return { entries: (userAddress && data?.entries) || NO_TRADES, isLoading };
}
export type MyTrades = ReturnType<typeof useMyTrades>;

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

/** A trade just made, kept until it shows on its market's tape */
interface SettlingTrade {
  poolAddress: string;
  /** the user's newest swap on that tape when the trade was sent */
  since?: number;
  side: MarketTrade["side"];
  /** whole tokens spent */
  spent: number;
}

const landed = (trade: SettlingTrade, ownTrades: MarketTrade[]): boolean =>
  ownTrades.some(
    (own) =>
      own.id > (trade.since ?? 0) &&
      own.side === trade.side &&
      Math.abs((own.side === "buy" ? own.amountQuote : own.amountBase) - trade.spent) <= trade.spent * 1e-9
  );

/**
 * Wallet balances around a trade. The read made right after a trade can land before the
 * indexer has the swap, and nothing else reads balances again, so they count as `settling`
 * until the trade shows on its market's tape (or a time limit passes) and are read once
 * more then. Kept above the order form so it survives a switch of market.
 */
export function useTradeSettling(poolAddress?: string) {
  const { fetchUsdstBalance } = useTokenContext();
  const { fetchTokens } = useUserTokens();
  const [settling, setSettling] = useState<SettlingTrade>();
  const ownTrades = useOwnTrades(settling?.poolAddress ?? poolAddress, settling ? SETTLING_POLL_MS : undefined);
  const ownTradesRef = useRef(ownTrades);
  ownTradesRef.current = ownTrades;
  const refreshBalances = useCallback(
    () => Promise.all([fetchUsdstBalance(), fetchTokens()]),
    [fetchUsdstBalance, fetchTokens]
  );

  const ownLatestTradeId = ownTrades[0]?.id;
  useEffect(() => {
    if (!ownLatestTradeId) return;
    void refreshBalances().finally(() =>
      setSettling((current) => (current && landed(current, ownTradesRef.current) ? undefined : current))
    );
  }, [ownLatestTradeId, refreshBalances]);

  /** Call when a trade is sent on `poolAddress`; call what it returns once the trade has succeeded */
  const begin = (side: MarketTrade["side"], spent: number) => {
    const trade: SettlingTrade = { poolAddress: poolAddress!, since: ownLatestTradeId, side, spent };
    const releaseIf = (done: () => boolean) =>
      void refreshBalances().finally(() => setSettling((current) => (current === trade && done() ? undefined : current)));
    return () => {
      setSettling(trade);
      // it may have reached the tape while it was confirming: this read is then already final
      releaseIf(() => landed(trade, ownTradesRef.current));
      // and a trade that never shows on the tape must not hold the form forever
      window.setTimeout(() => releaseIf(() => true), SETTLING_TIMEOUT_MS);
    };
  };

  return { settling: !!settling, begin, refreshBalances };
}
