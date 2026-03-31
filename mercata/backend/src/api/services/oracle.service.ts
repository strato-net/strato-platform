import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { getPool } from "./lending.service";
import { PriceHistoryEntry, PriceHistoryResponse, OraclePriceEntry, OraclePriceMap } from "@mercata/shared-types";
import { toUTCTime } from "../helpers/cirrusHelpers";
import { calculateLPTokenPrice } from "../helpers/swapping.helper";
import { getHistory, getHistoryParams, HistoryParams, StorageHistoryElement } from "../helpers/history.helper";

const {
  PriceOracle,
  PriceOracleEvents,
  PriceOracleBatchUpdateEvents,
  Pool,
  PoolSwap,
  StablePoolCoins,
} = constants;

/**
 * Check if an address is an LP token by querying the PoolFactory's allPools array
 * @param accessToken - User access token
 * @param lpTokenAddress - Address to check
 * @returns Pool info if it's an LP token, null otherwise
 */
const findPoolByLPToken = async (
  accessToken: string,
  lpTokenAddress: string
): Promise<{ address: string; tokenA: string; tokenB: string } | null> => {
  // Query the PoolFactory's allPools array
  const { data: allPoolsData } = await cirrus.get(accessToken, `/${constants.PoolFactory}-allPools`, {
    params: {
      address: `eq.${constants.poolFactory}`,
      select: "value"
    }
  }).catch(() => ({ data: [] }));

  // Get pool addresses from the allPools array
  const poolAddresses = allPoolsData ? allPoolsData.map((entry: any) => entry.value) : [];

  if (poolAddresses.length === 0) {
    return null;
  }

  // Query pools registered in this factory to find one with matching lpToken
  const { data: poolsData } = await cirrus.get(accessToken, `/${Pool}`, {
    params: {
      address: `in.(${poolAddresses.join(',')})`,
      lpToken: `eq.${lpTokenAddress}`,
      select: "address,tokenA,tokenB"
    }
  }).catch(() => ({ data: [] }));

  if (poolsData && poolsData.length > 0) {
    return {
      address: poolsData[0].address,
      tokenA: poolsData[0].tokenA,
      tokenB: poolsData[0].tokenB
    };
  }

  return null;
};

export const getOraclePrices = async (
  accessToken: string,
  params: Record<string, string> = { select: "asset:key,price:value::text" }
): Promise<OraclePriceMap> => {
  const { data: rawPrices } = await cirrus.get(accessToken, `/${PriceOracle}-prices`, { params });

  const prices = rawPrices as OraclePriceEntry[];

  return new Map(
    prices?.filter((p: OraclePriceEntry) => p.asset && p.price).map((p: OraclePriceEntry) => [p.asset, p.price]) || []
  );
};

export const getRebaseFactors = async (
  accessToken: string
): Promise<Map<string, string>> => {
  const { data } = await cirrus.get(accessToken, `/${PriceOracle}-rebaseFactors`, {
    params: { select: "asset:key,factor:value::text" }
  }).catch(() => ({ data: [] }));

  return new Map(
    (data || [])
      .filter((r: any) => r.asset && r.factor && r.factor !== "0")
      .map((r: any) => [r.asset, r.factor])
  );
};

export const getPrice = async (
  accessToken: string,
  asset?: string
) => {
  const registry = await getPool(accessToken, { 
    select: `priceOracle:priceOracle_fkey(address,prices:${PriceOracle}-prices(asset:key,price:value::text))` 
  });

  const prices: { asset: string; price: string }[] = registry.priceOracle?.prices || [];

  if (asset) {
    const entry = prices.find(
      (p) => p.asset.toLowerCase() === asset.toLowerCase()
    );
    if (!entry) {
      throw new Error(`Price not found for asset ${asset}`);
    }
    return entry;
  }

  return prices;
};

export const setPrice = async (
  accessToken: string,
  userAddress: string,
  body: Record<string, string | undefined>
) => {
  try {
    const registry = await getPool(accessToken, {
      select: "priceOracle",
    });
    const priceOracle = registry.priceOracle;
    const tx = await buildFunctionTx({
      contractName: extractContractName(PriceOracle),
      contractAddress: priceOracle,
      method: "setAssetPrice",
      args: {
        asset: body.token,
        price: body.price,
      },
    }, userAddress, accessToken);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return {
      status,
      hash,
    };
  } catch (error) {
    throw error;
  }
};

const getOracleAddress = async (accessToken: string): Promise<string> => {
    // Get the oracle address from the lending registry
    const registry = await getPool(accessToken, {
      select: "priceOracle",
    });
    
    if (!registry.priceOracle) {
      throw new Error("Price oracle not found");
    }

    return registry.priceOracle.address || registry.priceOracle;
};

const fetchPriceEvents = async (
  accessToken: string,
  oracleAddress: string,
  assetAddress: string,
  startTime: Date,
  order: string
): Promise<PriceHistoryEntry[]> => {
    const params = {
      address: `eq.${oracleAddress}`,
      block_timestamp: `gte.${toUTCTime(startTime)}`,
      order,
    };

    // --- Query both tables ---
    const [singleResponse, batchResponse] = await Promise.all([
      cirrus.get(accessToken, `/${PriceOracleEvents}`, { params: { ...params, asset: `eq.${assetAddress}` } }).catch(err => {
        console.error(`[getPriceHistory] Error querying ${PriceOracleEvents}:`, err);
        return { data: [] };
      }),
      cirrus.get(accessToken, `/${PriceOracleBatchUpdateEvents}`, {
        params
      }).catch(err => {
        console.error(`[getPriceHistory] Error querying ${PriceOracleBatchUpdateEvents}:`, err);
        return { data: [] };
      })
    ]);

    function toPlainString(num: number): string {
      return num.toLocaleString("fullwide", { useGrouping: false });
    }

    const priceEvents: PriceHistoryEntry[] = [];

    // --- Normalize single asset events ---
    if (Array.isArray(singleResponse.data)) {
      singleResponse.data.forEach((event: any) => {
        priceEvents.push({
          id: event.id.toString(),
          timestamp: new Date(parseInt(event.timestamp) * 1000),
          asset: event.asset,
          price: toPlainString(event.price), // normalize to string
          blockTimestamp: new Date(event.block_timestamp),
        });
      });
    }

    // --- Normalize batch events ---
    if (Array.isArray(batchResponse.data)) {
      batchResponse.data.forEach((event: any) => {
        const assets = JSON.parse(event.assets);
        const priceValues = JSON.parse(event.priceValues);
        const idx = assets.indexOf(assetAddress);
        if (idx !== -1 && priceValues[idx] !== undefined) {
          priceEvents.push({
            id: event.id.toString(),
            timestamp: new Date(parseInt(event.timestamp) * 1000),
            asset: assetAddress,
            price: toPlainString(priceValues[idx]), // normalize to string
            blockTimestamp: new Date(event.block_timestamp),
          });
        }
      });
    }

    return priceEvents;
};

const createHourlyPriceMap = (priceEvents: PriceHistoryEntry[], intervalMs?: number): Map<number, PriceHistoryEntry> => {
    // Process events and create interval-based data points based on duration
    const interval = intervalMs || 60 * 60 * 1000;
    const intervalPrices = new Map<number, PriceHistoryEntry>();

    priceEvents.forEach((event) => {
      const blockTimestamp = event.blockTimestamp;
      // Round down to the nearest interval
      const intervalTimestamp = Math.floor(blockTimestamp.getTime() / interval) * interval;
      const intervalKey = intervalTimestamp;

      // Keep the latest price for each interval
      if (!intervalPrices.has(intervalKey) || blockTimestamp > intervalPrices.get(intervalKey)!.blockTimestamp) {
        intervalPrices.set(intervalKey, event);
      }
    });

    return intervalPrices;
};

const extractHourlyPriceMap = (priceEvents: PriceHistoryEntry[]): Map<string, string> => {
    const hourlyMap = createHourlyPriceMap(priceEvents);
    const priceMap = new Map<string, string>();
    hourlyMap.forEach((entry, hourKey) => {
      priceMap.set(`${(new Date(hourKey)).toISOString()}`, entry.price);
    });
    return priceMap;
};

const fetchPoolHistory = async (
  accessToken: string,
  poolAddress: string,
  lpTokenAddress: string
): Promise<Array<{ timestamp: number; data: { tokenABalance: string; tokenBBalance: string; lpTokenTotalSupply: string } }>> => {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const oneMonthInHours = 24 * 30;

    const historyParams = {
      endTimestamp: Date.now(),
      interval: 1000 * 60 * 60, // 1 hour
      numTicks: oneMonthInHours
    };

    const poolStorageReducer = (data: any, h: StorageHistoryElement): any => {
      const tokenABalance = h.data?.tokenABalance || data.tokenABalance || "0";
      const tokenBBalance = h.data?.tokenBBalance || data.tokenBBalance || "0";
      return {
        tokenABalance,
        tokenBBalance,
        lpTokenTotalSupply: data.lpTokenTotalSupply || "0"
      };
    };

    const lpTokenStorageReducer = (data: any, h: StorageHistoryElement): any => {
      const lpTokenTotalSupply = h.data?._totalSupply || data.lpTokenTotalSupply || "0";
      return {
        tokenABalance: data.tokenABalance || "0",
        tokenBBalance: data.tokenBBalance || "0",
        lpTokenTotalSupply
      };
    };

    const combinedReducer = (data: any, h: StorageHistoryElement): any => {
      if (h.address.toLowerCase() === poolAddress.toLowerCase()) {
        return poolStorageReducer(data, h);
      } else if (h.address.toLowerCase() === lpTokenAddress.toLowerCase()) {
        return lpTokenStorageReducer(data, h);
      }
      return data;
    };

    return await getHistory(
      accessToken,
      historyParams,
      [`address.eq.${poolAddress}`, `address.eq.${lpTokenAddress}`],
      [],
      [],
      { tokenABalance: "0", tokenBBalance: "0", lpTokenTotalSupply: "0" },
      combinedReducer,
      ((s, _) => s),
      ((s, _) => s)
    );
};

const calculateHourlyLPPrices = (
  poolHistory: Array<{ timestamp: number; data: { tokenABalance: string; tokenBBalance: string; lpTokenTotalSupply: string } }>,
  tokenAPriceMap: Map<string, string>,
  tokenBPriceMap: Map<string, string>,
  lpTokenAddress: string
): Map<number, PriceHistoryEntry> => {
    const hourlyLPPrices = new Map<number, PriceHistoryEntry>();
    let lastTokenAPrice = "0";
    let lastTokenBPrice = "0";

    poolHistory.forEach((snapshot) => {
      const timestamp = new Date(snapshot.timestamp);
      timestamp.setMinutes(0, 0, 0);
      const hourKey = timestamp.toISOString();
      const hourKeyNumber = timestamp.getTime();

      const tokenAPrice = tokenAPriceMap.get(hourKey) || lastTokenAPrice;
      const tokenBPrice = tokenBPriceMap.get(hourKey) || lastTokenBPrice;

      if (tokenAPrice !== "0") lastTokenAPrice = tokenAPrice;
      if (tokenBPrice !== "0") lastTokenBPrice = tokenBPrice;

      const { tokenABalance, tokenBBalance, lpTokenTotalSupply } = snapshot.data;

      if (!tokenABalance || !tokenBBalance || !lpTokenTotalSupply ||
          tokenABalance === "0" || tokenBBalance === "0" || lpTokenTotalSupply === "0" ||
          tokenAPrice === "0" || tokenBPrice === "0") {
        return;
      }

      const lpTokenPrice = calculateLPTokenPrice(
        tokenABalance,
        tokenBBalance,
        tokenAPrice,
        tokenBPrice,
        lpTokenTotalSupply
      );

      if (!hourlyLPPrices.has(hourKeyNumber) || timestamp > hourlyLPPrices.get(hourKeyNumber)!.blockTimestamp) {
        hourlyLPPrices.set(hourKeyNumber, {
          id: `lp-${timestamp.getTime()}`,
          timestamp: timestamp,
          asset: lpTokenAddress,
          price: lpTokenPrice,
          blockTimestamp: timestamp
        });
      }
    });

    return hourlyLPPrices;
};

const forwardFillPriceHistory = (
  intervalPrices: Map<number, PriceHistoryEntry>,
  assetAddress: string,
  intervalMs: number,
): PriceHistoryEntry[] => {
    if (intervalPrices.size === 0) {
      console.log(`[getPriceHistory] No historical oracle data found for ${assetAddress}`);
      return [];
    }

    // Find the earliest and latest actual data points
    const sortedEvents = Array.from(intervalPrices.values()).sort(
      (a, b) => a.blockTimestamp.getTime() - b.blockTimestamp.getTime()
    );

    const earliestDataPoint = sortedEvents[0];
    const latestDataPoint = sortedEvents[sortedEvents.length - 1];

    // Start from the earliest actual data point (rounded to interval)
    const earliestInterval = Math.floor(earliestDataPoint.blockTimestamp.getTime() / intervalMs) * intervalMs;
    const earliestStartTime = new Date(earliestInterval);

    // End at current time (or latest data point if it's more recent)
    const now = new Date();
    const endTime = latestDataPoint.blockTimestamp > now ? latestDataPoint.blockTimestamp : now;
    const endInterval = Math.ceil(endTime.getTime() / intervalMs) * intervalMs;

    const filledPriceHistory: PriceHistoryEntry[] = [];
    let currentPrice = earliestDataPoint.price;

    // Generate interval-based timestamps from first data point to now
    for (let currentInterval = earliestStartTime.getTime(); currentInterval <= endInterval; currentInterval += intervalMs) {
      const intervalKey = currentInterval;

      if (intervalPrices.has(intervalKey)) {
        // We have actual data for this interval
        const actualData = intervalPrices.get(intervalKey)!;
        currentPrice = actualData.price;
        filledPriceHistory.push(actualData);
      } else {
        // Fill gap with last known price
        filledPriceHistory.push({
          id: `filled-${currentInterval}`,
          timestamp: new Date(currentInterval),
          asset: assetAddress,
          price: currentPrice.toString(),
          blockTimestamp: new Date(currentInterval)
        });
      }
    }

    return filledPriceHistory;
};

export const getPriceHistory = async (
  accessToken: string,
  assetAddress: string,
  rawParams: Record<string, string | undefined> = {}
): Promise<PriceHistoryResponse> => {
  try {
    // If the asset is an LP token, calculate the price history as net asset value
    const matchingPool = await findPoolByLPToken(accessToken, assetAddress);
    if (matchingPool) {
      return getLPTokenPriceHistory(accessToken, assetAddress, matchingPool, rawParams);
    }

    // If the asset is not an LP token, just get the oracle price history
    const oracleAddress = await getOracleAddress(accessToken);

    // Use duration parameter if provided, otherwise default to 1 month
    const duration = rawParams.duration || '1m';
    const historyParams = getHistoryParams(duration, rawParams.end);
    const startTime = new Date(historyParams.endTimestamp - (historyParams.interval * historyParams.numTicks));

    // Calculate time range for the last month
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const priceEvents = await fetchPriceEvents(
      accessToken,
      oracleAddress,
      assetAddress,
      startTime,
      rawParams.order || "block_timestamp.asc"
    );

    if (priceEvents.length === 0) {
      console.log(`[getPriceHistory] No data found for ${assetAddress}`);
      return { data: [], totalCount: 0 };
    }

    // Process events and create hourly data points
    const hourlyPrices = createHourlyPriceMap(priceEvents, historyParams?.interval);

    // If no historical data, return empty
    if (hourlyPrices.size === 0) {
      console.log(`[getPriceHistory] No historical oracle data found for ${assetAddress}`);
      return { data: [], totalCount: 0 };
    }

    const filledPriceHistory = forwardFillPriceHistory(hourlyPrices, assetAddress, historyParams?.interval);

    return { data: filledPriceHistory, totalCount: filledPriceHistory.length };
  } catch (error) {
    console.error('Error fetching price history:', error);
    throw new Error('Failed to fetch price history');
  }
};

const getLPTokenPriceHistory = async (
  accessToken: string,
  lpTokenAddress: string,
  pool: { address: string; tokenA: string; tokenB: string },
  rawParams: Record<string, string | undefined> = {}
): Promise<PriceHistoryResponse> => {
  try {
    const poolAddress = pool.address;
    const tokenA = pool.tokenA;
    const tokenB = pool.tokenB;

    const oracleAddress = await getOracleAddress(accessToken);
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const order = rawParams.order || "block_timestamp.asc";

    const [tokenAPriceEvents, tokenBPriceEvents] = await Promise.all([
      fetchPriceEvents(accessToken, oracleAddress, tokenA, oneMonthAgo, order),
      fetchPriceEvents(accessToken, oracleAddress, tokenB, oneMonthAgo, order)
    ]);

    const tokenAPriceMap = extractHourlyPriceMap(tokenAPriceEvents);
    const tokenBPriceMap = extractHourlyPriceMap(tokenBPriceEvents);

    const poolHistory = await fetchPoolHistory(accessToken, poolAddress, lpTokenAddress);

    if (poolHistory.length === 0) {
      console.log(`[getLPTokenPriceHistory] No pool history found for ${poolAddress}`);
      return { data: [], totalCount: 0 };
    }

    const hourlyLPPrices = calculateHourlyLPPrices(
      poolHistory,
      tokenAPriceMap,
      tokenBPriceMap,
      lpTokenAddress
    );

    if (hourlyLPPrices.size === 0) {
      console.log(`[getLPTokenPriceHistory] No LP token price data found for ${lpTokenAddress}`);
      return { data: [], totalCount: 0 };
    }

    const filledPriceHistory = forwardFillPriceHistory(hourlyLPPrices, lpTokenAddress, 60 * 60 * 1000);

    return { data: filledPriceHistory, totalCount: filledPriceHistory.length };
  } catch (error) {
    console.error('Error fetching LP token price history:', error);
    throw new Error('Failed to fetch LP token price history');
  }
};

// ============================================================================
// STRATO PRICE HISTORY (swap-implied USD price across all pools)
// ============================================================================

type PoolInfo = {
  address: string;
  isStable: boolean;
  isMultiToken: boolean;
  tokenA?: string;
  tokenB?: string;
  coins?: string[];
};

/**
 * Find every pool that contains the given asset.
 * StablePool contracts appear in both BlockApps-Pool (with tokenA/tokenB) and
 * BlockApps-StablePool-coins; pools with >2 coins are classified as multi-token.
 */
const discoverPoolsForAsset = async (
  accessToken: string,
  assetAddress: string
): Promise<PoolInfo[]> => {
  const [{ data: poolRows }, { data: coinRows }] = await Promise.all([
    cirrus.get(accessToken, `/${Pool}`, {
      params: {
        or: `(tokenA.eq.${assetAddress},tokenB.eq.${assetAddress})`,
        select: "address,tokenA,tokenB,isStable",
      }
    }).catch(() => ({ data: [] })),
    cirrus.get(accessToken, `/${StablePoolCoins}`, {
      params: { value: `eq.${assetAddress}`, select: "address" }
    }).catch(() => ({ data: [] })),
  ]);

  const allCandidateAddrs = new Set<string>();
  for (const p of (poolRows || []) as any[]) allCandidateAddrs.add(p.address);
  for (const c of (coinRows || []) as any[]) allCandidateAddrs.add(c.address);

  // Fetch full coin lists to distinguish 2-coin from >2-coin pools
  const coinsByPool = new Map<string, string[]>();
  if (allCandidateAddrs.size > 0) {
    const { data: allCoins } = await cirrus.get(accessToken, `/${StablePoolCoins}`, {
      params: {
        address: `in.(${[...allCandidateAddrs].join(",")})`,
        select: "address,key,value",
      }
    }).catch(() => ({ data: [] }));

    for (const row of (allCoins || []) as any[]) {
      const list = coinsByPool.get(row.address) || [];
      list.push(row.value);
      coinsByPool.set(row.address, list);
    }
  }

  const poolRowMap = new Map<string, any>();
  for (const p of (poolRows || []) as any[]) poolRowMap.set(p.address, p);

  const results: PoolInfo[] = [];
  for (const addr of allCandidateAddrs) {
    const coins = coinsByPool.get(addr);
    const poolRow = poolRowMap.get(addr);

    if (coins && coins.length > 2) {
      results.push({ address: addr, isStable: true, isMultiToken: true, coins });
    } else if (poolRow && poolRow.tokenA && poolRow.tokenB) {
      results.push({
        address: addr,
        isStable: !!poolRow.isStable,
        isMultiToken: false,
        tokenA: poolRow.tokenA,
        tokenB: poolRow.tokenB,
      });
    }
  }
  return results;
};

/**
 * Forward-fill an interval-keyed oracle price map so every tick has a value.
 */
const buildForwardFilledOracleMap = (
  intervalMap: Map<number, PriceHistoryEntry>,
  intervalMs: number
): Map<number, string> => {
  const sortedKeys = Array.from(intervalMap.keys()).sort((a, b) => a - b);
  const filled = new Map<number, string>();
  if (sortedKeys.length === 0) return filled;

  let lastPrice = "0";
  const end = Math.max(sortedKeys[sortedKeys.length - 1], Date.now());
  for (let t = sortedKeys[0]; t <= end; t += intervalMs) {
    if (intervalMap.has(t)) lastPrice = intervalMap.get(t)!.price;
    if (lastPrice !== "0") filled.set(t, lastPrice);
  }
  return filled;
};

/**
 * Look up the oracle price at `tick`, falling back up to 24 intervals.
 */
const lookupOraclePrice = (
  filledMap: Map<number, string>,
  tick: number,
  intervalMs: number
): string | undefined => {
  if (filledMap.has(tick)) return filledMap.get(tick);
  for (let t = tick - intervalMs; t >= tick - 24 * intervalMs; t -= intervalMs) {
    if (filledMap.has(t)) return filledMap.get(t);
  }
  return undefined;
};

/**
 * Compute historical STRATO (swap-implied) USD price for an asset across all
 * pools it participates in.
 *
 * - 2-token pools (volatile + stable): price derived from pool balance ratio
 *   and the counterpart token's historical oracle price, weighted by
 *   counterpart-side USD liquidity.
 * - Multi-token stable pools (>2 coins): price derived from individual swap
 *   events (amountOut/amountIn) and the counterpart's historical oracle price,
 *   weighted by USD trade volume.
 *
 * Results are bucketed into intervals matching the spot price endpoint,
 * aggregated as a liquidity-weighted average, and forward-filled.
 */
export const getStratoPriceHistory = async (
  accessToken: string,
  assetAddress: string,
  rawParams: Record<string, string | undefined> = {}
): Promise<PriceHistoryResponse> => {
  try {
    const duration = rawParams.duration || '1m';
    const historyParams = getHistoryParams(duration, rawParams.end);
    const intervalMs = historyParams.interval;
    const startTime = new Date(historyParams.endTimestamp - (historyParams.interval * historyParams.numTicks));

    const allPools = await discoverPoolsForAsset(accessToken, assetAddress);
    const twoTokenPools = allPools.filter(p => !p.isMultiToken && p.tokenA && p.tokenB);
    const multiTokenPools = allPools.filter(p => p.isMultiToken && p.coins);

    if (twoTokenPools.length === 0 && multiTokenPools.length === 0) {
      return { data: [], totalCount: 0 };
    }

    // Collect all counterpart token addresses
    const otherTokenAddrs = new Set<string>();
    for (const pool of twoTokenPools) {
      const other = pool.tokenA!.toLowerCase() === assetAddress.toLowerCase()
        ? pool.tokenB! : pool.tokenA!;
      otherTokenAddrs.add(other);
    }
    for (const pool of multiTokenPools) {
      for (const coin of pool.coins!) {
        if (coin.toLowerCase() !== assetAddress.toLowerCase()) otherTokenAddrs.add(coin);
      }
    }

    // Fetch oracle histories, pool storage histories, and multi-token swap events in parallel
    const oracleAddress = await getOracleAddress(accessToken);

    const oraclePromises = [...otherTokenAddrs].map(async (tokenAddr) => {
      const events = await fetchPriceEvents(accessToken, oracleAddress, tokenAddr, startTime, "block_timestamp.asc");
      return { tokenAddr, filledMap: buildForwardFilledOracleMap(createHourlyPriceMap(events, intervalMs), intervalMs) };
    });

    const poolHistoryPromises = twoTokenPools.map(async (pool) => {
      const storageReducer = (data: any, h: StorageHistoryElement): any => ({
        tokenABalance: h.data?.tokenABalance ?? data.tokenABalance ?? "0",
        tokenBBalance: h.data?.tokenBBalance ?? data.tokenBBalance ?? "0",
        isStable: h.data?.isStable ?? data.isStable ?? false,
        aToBRatio: h.data?.aToBRatio ?? data.aToBRatio ?? "0",
      });

      const snapshots = await getHistory(
        accessToken, historyParams,
        [`address.eq.${pool.address}`], [], [],
        { tokenABalance: "0", tokenBBalance: "0", isStable: false, aToBRatio: "0" },
        storageReducer, (s => s), (s => s)
      );
      return { pool, snapshots };
    });

    const multiTokenSwapPromises = multiTokenPools.map(async (pool) => {
      const { data: events } = await cirrus.get(accessToken, `/${PoolSwap}`, {
        params: {
          address: `eq.${pool.address}`,
          block_timestamp: `gte.${toUTCTime(startTime)}`,
          select: "id,block_timestamp,tokenIn,tokenOut,amountIn::text,amountOut::text",
          order: "block_timestamp.asc",
          limit: "10000",
        }
      }).catch(() => ({ data: [] }));
      return { pool, swapEvents: (events || []) as any[] };
    });

    const [oracleResults, poolHistoryResults, multiTokenSwapResults] = await Promise.all([
      Promise.all(oraclePromises),
      Promise.all(poolHistoryPromises),
      Promise.all(multiTokenSwapPromises),
    ]);

    const oracleLookup = new Map<string, Map<number, string>>();
    for (const { tokenAddr, filledMap } of oracleResults) {
      oracleLookup.set(tokenAddr.toLowerCase(), filledMap);
    }

    // Compute weighted prices from all pools
    type WeightedPrice = { usdPrice: number; weight: number; tick: number };
    const weightedPrices: WeightedPrice[] = [];

    // 2-token pools: balance-ratio approach
    for (const { pool, snapshots } of poolHistoryResults) {
      const isAssetTokenA = pool.tokenA!.toLowerCase() === assetAddress.toLowerCase();
      const otherAddr = isAssetTokenA ? pool.tokenB! : pool.tokenA!;
      const otherPriceMap = oracleLookup.get(otherAddr.toLowerCase());
      if (!otherPriceMap || otherPriceMap.size === 0) continue;

      for (const snapshot of snapshots) {
        const { tokenABalance, tokenBBalance, isStable, aToBRatio } = snapshot.data;
        const balA = parseFloat(tokenABalance);
        const balB = parseFloat(tokenBBalance);
        if (balA === 0 && balB === 0) continue;

        const ratio = isStable
          ? (parseFloat(aToBRatio) || (balA > 0 ? balB / balA : 0))
          : (balA > 0 ? balB / balA : 0);
        if (ratio === 0 || !isFinite(ratio)) continue;

        const tick = Math.floor(snapshot.timestamp / intervalMs) * intervalMs;
        const otherPriceStr = lookupOraclePrice(otherPriceMap, tick, intervalMs);
        if (!otherPriceStr || otherPriceStr === "0") continue;
        const otherPriceUsd = Number(BigInt(otherPriceStr)) / 1e18;

        const usdPrice = isAssetTokenA
          ? ratio * otherPriceUsd
          : (1 / ratio) * otherPriceUsd;
        if (usdPrice <= 0 || !isFinite(usdPrice)) continue;

        const counterpartBal = isAssetTokenA ? balB : balA;
        const weight = (counterpartBal / 1e18) * otherPriceUsd;

        weightedPrices.push({ usdPrice, weight: weight > 0 ? weight : 1, tick });
      }
    }

    // Multi-token stable pools: swap-event approach
    for (const { pool, swapEvents } of multiTokenSwapResults) {
      const assetLower = assetAddress.toLowerCase();
      for (const evt of swapEvents) {
        const tokenInLower = evt.tokenIn.toLowerCase();
        const tokenOutLower = evt.tokenOut.toLowerCase();

        let otherAddr: string;
        let ourAmount: number;
        if (tokenInLower === assetLower) {
          otherAddr = evt.tokenOut;
          ourAmount = parseFloat(evt.amountIn) || 0;
        } else if (tokenOutLower === assetLower) {
          otherAddr = evt.tokenIn;
          ourAmount = parseFloat(evt.amountOut) || 0;
        } else {
          continue;
        }

        const otherPriceMap = oracleLookup.get(otherAddr.toLowerCase());
        if (!otherPriceMap || otherPriceMap.size === 0) continue;

        const tick = Math.floor(new Date(evt.block_timestamp).getTime() / intervalMs) * intervalMs;
        const otherPriceStr = lookupOraclePrice(otherPriceMap, tick, intervalMs);
        if (!otherPriceStr || otherPriceStr === "0") continue;
        const otherPriceUsd = Number(BigInt(otherPriceStr)) / 1e18;

        const amtIn = parseFloat(evt.amountIn) || 0;
        const amtOut = parseFloat(evt.amountOut) || 0;
        if (amtIn === 0 || amtOut === 0) continue;

        const otherPerOurs = tokenInLower === assetLower ? amtOut / amtIn : amtIn / amtOut;
        const usdPrice = otherPerOurs * otherPriceUsd;
        if (usdPrice <= 0 || !isFinite(usdPrice)) continue;

        const usdVolume = (ourAmount / 1e18) * usdPrice;
        weightedPrices.push({ usdPrice, weight: usdVolume > 0 ? usdVolume : 1, tick });
      }
    }

    if (weightedPrices.length === 0) {
      return { data: [], totalCount: 0 };
    }

    // Aggregate into liquidity-weighted interval averages
    const buckets = new Map<number, { totalWP: number; totalW: number }>();
    for (const { usdPrice, weight, tick } of weightedPrices) {
      const b = buckets.get(tick) || { totalWP: 0, totalW: 0 };
      b.totalWP += usdPrice * weight;
      b.totalW += weight;
      buckets.set(tick, b);
    }

    const intervalPrices = new Map<number, PriceHistoryEntry>();
    buckets.forEach(({ totalWP, totalW }, tick) => {
      const avg = totalWP / totalW;
      intervalPrices.set(tick, {
        id: `strato-${tick}`,
        timestamp: new Date(tick),
        asset: assetAddress,
        price: BigInt(Math.round(avg * 1e18)).toString(),
        blockTimestamp: new Date(tick),
      });
    });

    const filled = forwardFillPriceHistory(intervalPrices, assetAddress, intervalMs);
    return { data: filled, totalCount: filled.length };
  } catch (error) {
    console.error("[getStratoPriceHistory] Error:", error);
    throw new Error("Failed to fetch STRATO price history");
  }
};
