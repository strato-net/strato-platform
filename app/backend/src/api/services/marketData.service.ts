/**
 * Trading-terminal market data service. Every V3 pool is a market; each keeps one
 * in-memory aggregate (candles, trade tape, 24h stats) built from the pool's Swap events
 * and topped up incrementally by event id whenever a request finds it stale.
 */
import RestStatus from "http-status-codes";
import { cirrus } from "../../utils/appApiHelper";
import { isMissingTableError } from "../../utils/cirrusErrors";
import { getServiceToken } from "../../utils/authHelper";
import * as config from "../../config/config";
import { constants } from "../../config/constants";
import { POOL_V3_CONTRACTS, POOL_V3_MARKET_SWAP_SELECT_FIELDS } from "../../config/poolV3Constants";
import { getPools } from "./poolV3.service";
import {
  MarketOrientation,
  MarketState,
  RawSwapRow,
  candlesFrom,
  emptyMarketState,
  foldSwap,
  marketPrice,
  marketStats,
} from "../helpers/marketData.helper";
import { CandleResolution, Market, MarketCandle, MarketStats, MarketTrade, PoolV3 } from "@strato/shared-types";

const { PoolV3: PoolV3Table, PoolV3SwapEvent } = POOL_V3_CONTRACTS;

const REFRESH_INTERVAL_MS = 2000;
const SWAP_PAGE_SIZE = 20000;

const normalizeAddress = (address: string): string => address.toLowerCase().replace(/^0x/, "");

// ============================================================================
// MARKETS
// ============================================================================

/** Pools whose swap() is restricted to the gas fee router (users cannot trade them) */
const fetchGasLockedPools = async (accessToken: string, poolAddresses: string[]): Promise<Set<string>> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${PoolV3Table}`, {
      params: { address: `in.(${poolAddresses.join(",")})`, select: "address,gasSwapRouter" },
    });
    return new Set(
      ((data as { address: string; gasSwapRouter: string }[]) ?? [])
        .filter((row) => row.gasSwapRouter && row.gasSwapRouter !== constants.ZERO_ADDRESS)
        .map((row) => row.address)
    );
  } catch (err) {
    // pools deployed before the gas-only lock have no gasSwapRouter column
    if (isMissingTableError(err)) return new Set();
    throw err;
  }
};

const orientationOf = (market: Market): MarketOrientation => ({
  baseIsToken0: market.baseIsToken0,
  baseDecimals: market.base.decimals,
  quoteDecimals: market.quote.decimals,
});

/** USDST is always the quote side; otherwise the pool's own token0/token1 order stands */
const toMarket = (pool: PoolV3, gasLocked: boolean): Market => {
  const baseIsToken0 = pool.token0.address !== constants.USDST;
  const [base, quote] = baseIsToken0 ? [pool.token0, pool.token1] : [pool.token1, pool.token0];
  const market: Market = {
    id: `${base.symbol}-${quote.symbol}`,
    poolAddress: pool.address,
    base,
    quote,
    baseIsToken0,
    feeBps: pool.fee / 100,
    price: 0,
    oraclePrice: 0,
    baseBalance: baseIsToken0 ? pool.token0Balance : pool.token1Balance,
    quoteBalance: baseIsToken0 ? pool.token1Balance : pool.token0Balance,
    totalLiquidityUSD: pool.totalLiquidityUSD,
    tradable: !pool.isPaused && !gasLocked && !config.hiddenSwapPools.has(pool.address),
  };
  market.price = marketPrice(pool.sqrtPriceX96, orientationOf(market));
  // the pool reports its oracle price as whole token1 per whole token0
  const oracleToken1PerToken0 = Number(pool.oraclePriceWad) / 1e18;
  if (oracleToken1PerToken0 > 0) market.oraclePrice = baseIsToken0 ? oracleToken1PerToken0 : 1 / oracleToken1PerToken0;
  return market;
};

/** Every enabled V3 pool as a market, deepest liquidity first */
export const getMarkets = async (accessToken: string): Promise<Market[]> => {
  const pools = (await getPools(accessToken)).filter((pool) => !pool.isDisabled);
  if (pools.length === 0) return [];
  const gasLocked = await fetchGasLockedPools(accessToken, pools.map((pool) => pool.address));
  // a pair can have one pool per fee tier: the deepest keeps the bare slug, the others add their fee
  const ids = new Set<string>();
  return pools.map((pool) => {
    const market = toMarket(pool, gasLocked.has(pool.address));
    if (ids.has(market.id)) market.id += `-${market.feeBps}`;
    ids.add(market.id);
    return market;
  });
};

// ============================================================================
// AGGREGATOR
// ============================================================================

interface TrackedMarket {
  state: MarketState;
  orientation: MarketOrientation;
  refreshedAtMs: number;
  refreshing?: Promise<void>;
}

const tracked = new Map<string, TrackedMarket>();

/** The market's aggregate, created on first use at the pool's current price (a pool that
 *  has never traded still has one) */
const track = (market: Market): TrackedMarket => {
  let entry = tracked.get(market.poolAddress);
  if (!entry) {
    entry = { state: { ...emptyMarketState(), price: market.price }, orientation: orientationOf(market), refreshedAtMs: 0 };
    tracked.set(market.poolAddress, entry);
  }
  return entry;
};

const fetchSwapsAfter = async (accessToken: string, poolAddress: string, afterId: number): Promise<RawSwapRow[]> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${PoolV3SwapEvent}`, {
      params: {
        address: `eq.${poolAddress}`,
        id: `gt.${afterId}`,
        select: POOL_V3_MARKET_SWAP_SELECT_FIELDS.join(","),
        order: "id.asc",
        limit: SWAP_PAGE_SIZE.toString(),
      },
    });
    return (data as RawSwapRow[]) ?? [];
  } catch (err) {
    // the event table is created lazily on the first swap
    if (isMissingTableError(err)) return [];
    throw err;
  }
};

const refresh = async (accessToken: string, poolAddress: string, market: TrackedMarket): Promise<void> => {
  for (;;) {
    const rows = await fetchSwapsAfter(accessToken, poolAddress, market.state.lastId);
    for (const row of rows) foldSwap(market.state, row, market.orientation, constants.FEE_ADDRESS);
    if (rows.length < SWAP_PAGE_SIZE) break;
  }
  market.refreshedAtMs = Date.now();
};

/** The pool's aggregate, brought up to date first when older than the refresh interval.
 *  Concurrent callers share one refresh; the first call for a pool loads its history. */
const getMarketState = async (accessToken: string, poolAddress: string): Promise<MarketState> => {
  const address = normalizeAddress(poolAddress);
  let market = tracked.get(address);
  if (!market) {
    const info = (await getMarkets(accessToken)).find((m) => m.poolAddress === address);
    if (!info) throw Object.assign(new Error("Market not found"), { statusCode: RestStatus.NOT_FOUND });
    market = track(info);
  }
  if (!market.refreshing && Date.now() - market.refreshedAtMs > REFRESH_INTERVAL_MS) {
    const current = market;
    current.refreshing = refresh(accessToken, address, current).finally(() => {
      current.refreshing = undefined;
    });
  }
  if (market.refreshing) await market.refreshing;
  return market.state;
};

export const getMarketCandles = async (
  accessToken: string,
  poolAddress: string,
  resolution: CandleResolution,
  from?: number
): Promise<MarketCandle[]> => candlesFrom(await getMarketState(accessToken, poolAddress), resolution, Date.now(), from);

export const getMarketTrades = async (accessToken: string, poolAddress: string, limit: number): Promise<MarketTrade[]> =>
  (await getMarketState(accessToken, poolAddress)).tape.slice(-limit).reverse();

export const getMarketStats = async (accessToken: string, poolAddress: string): Promise<MarketStats> =>
  marketStats(await getMarketState(accessToken, poolAddress), Date.now());

/** Load every market's history at startup so the first visitor does not wait for it */
export const warmMarketData = async (): Promise<void> => {
  try {
    const accessToken = await getServiceToken();
    for (const market of await getMarkets(accessToken)) {
      track(market);
      await getMarketState(accessToken, market.poolAddress);
    }
  } catch (err) {
    console.warn("Market data warm-up failed; it will load on first request:", (err as Error).message);
  }
};
