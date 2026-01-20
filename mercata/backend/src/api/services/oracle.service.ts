import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { getPool } from "./lending.service";
import { PriceHistoryEntry, PriceHistoryResponse, OraclePriceEntry, OraclePriceMap } from "@mercata/shared-types";
import { toUTCTime } from "../helpers/cirrusHelpers";
import { calculateLPTokenPrice } from "../helpers/swapping.helper";
import { getHistory, StorageHistoryElement } from "../helpers/history.helper";

const {
  PriceOracle,
  PriceOracleEvents,
  PriceOracleBatchUpdateEvents,
  Pool,
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
  oneMonthAgo: Date,
  order: string
): Promise<PriceHistoryEntry[]> => {
    const params = {
      address: `eq.${oracleAddress}`,
      block_timestamp: `gte.${toUTCTime(oneMonthAgo)}`,
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

const createHourlyPriceMap = (priceEvents: PriceHistoryEntry[]): Map<string, PriceHistoryEntry> => {
    const hourlyPrices = new Map<string, PriceHistoryEntry>();

    priceEvents.forEach((event) => {
      const blockTimestamp = event.blockTimestamp;

      // Create hourly bucket (round down to the hour)
      const hourBucket = new Date(blockTimestamp);
      hourBucket.setMinutes(0, 0, 0);
      const hourKey = hourBucket.toISOString();

      // Keep the latest price for each hour
      if (!hourlyPrices.has(hourKey) || blockTimestamp > hourlyPrices.get(hourKey)!.blockTimestamp) {
        hourlyPrices.set(hourKey, event);
      }
    });

    return hourlyPrices;
};

const extractHourlyPriceMap = (priceEvents: PriceHistoryEntry[]): Map<string, string> => {
    const hourlyMap = createHourlyPriceMap(priceEvents);
    const priceMap = new Map<string, string>();
    hourlyMap.forEach((entry, hourKey) => {
      priceMap.set(hourKey, entry.price);
    });
    return priceMap;
};

const forwardFillPriceHistory = (
  hourlyPrices: Map<string, PriceHistoryEntry>,
  assetAddress: string
): PriceHistoryEntry[] => {
    if (hourlyPrices.size === 0) {
      console.log(`[getPriceHistory] No historical oracle data found for ${assetAddress}`);
      return [];
    }

    // Find the earliest and latest actual data points
    const sortedEvents = Array.from(hourlyPrices.values()).sort(
      (a, b) => a.blockTimestamp.getTime() - b.blockTimestamp.getTime()
    );

    const earliestDataPoint = sortedEvents[0];
    const latestDataPoint = sortedEvents[sortedEvents.length - 1];

    // Start from the earliest actual data point (rounded to hour)
    const startTime = new Date(earliestDataPoint.blockTimestamp);
    startTime.setMinutes(0, 0, 0);

    // End at current time (or latest data point if it's more recent)
    const now = new Date();
    const endTime = latestDataPoint.blockTimestamp > now ? latestDataPoint.blockTimestamp : now;

    const filledPriceHistory: PriceHistoryEntry[] = [];
    let currentPrice = earliestDataPoint.price;

    // Generate hourly timestamps from first data point to now
    for (let currentHour = new Date(startTime); currentHour <= endTime; currentHour.setHours(currentHour.getHours() + 1)) {
      const hourKey = currentHour.toISOString();

      if (hourlyPrices.has(hourKey)) {
        // We have actual data for this hour
        const actualData = hourlyPrices.get(hourKey)!;
        currentPrice = actualData.price;
        filledPriceHistory.push(actualData);
      } else {
        // Fill gap with last known price
        filledPriceHistory.push({
          id: `filled-${currentHour.getTime()}`,
          timestamp: new Date(currentHour),
          asset: assetAddress,
          price: currentPrice.toString(),
          blockTimestamp: new Date(currentHour)
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
    const matchingPool = await findPoolByLPToken(accessToken, assetAddress);

    if (matchingPool) {
      return getLPTokenPriceHistoryInternal(accessToken, assetAddress, matchingPool, rawParams);
    }

    const oracleAddress = await getOracleAddress(accessToken);

    // Calculate time range for the last month
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const priceEvents = await fetchPriceEvents(
      accessToken,
      oracleAddress,
      assetAddress,
      oneMonthAgo,
      rawParams.order || "block_timestamp.asc"
    );

    if (priceEvents.length === 0) {
      console.log(`[getPriceHistory] No data found for ${assetAddress}`);
      return { data: [], totalCount: 0 };
    }

    // Process events and create hourly data points
    const hourlyPrices = createHourlyPriceMap(priceEvents);

    // If no historical data, return empty
    if (hourlyPrices.size === 0) {
      console.log(`[getPriceHistory] No historical oracle data found for ${assetAddress}`);
      return { data: [], totalCount: 0 };
    }

    const filledPriceHistory = forwardFillPriceHistory(hourlyPrices, assetAddress);

    return { data: filledPriceHistory, totalCount: filledPriceHistory.length };
  } catch (error) {
    console.error('Error fetching price history:', error);
    throw new Error('Failed to fetch price history');
  }
};

const getLPTokenPriceHistoryInternal = async (
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

    const historyParams = {
      endTimestamp: Date.now(),
      interval: 1000 * 60 * 60, // 1 hour
      numTicks: 24 * 30 // 30 days
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

    const poolHistory = await getHistory(
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

    if (poolHistory.length === 0) {
      console.log(`[getLPTokenPriceHistory] No pool history found for ${poolAddress}`);
      return { data: [], totalCount: 0 };
    }

    const hourlyLPPrices = new Map<string, PriceHistoryEntry>();
    let lastTokenAPrice = "0";
    let lastTokenBPrice = "0";

    poolHistory.forEach((snapshot) => {
      const timestamp = new Date(snapshot.timestamp);
      timestamp.setMinutes(0, 0, 0);
      const hourKey = timestamp.toISOString();

      const tokenAPrice = tokenAPriceMap.get(hourKey) || lastTokenAPrice;
      const tokenBPrice = tokenBPriceMap.get(hourKey) || lastTokenBPrice;

      if (tokenAPrice !== "0") lastTokenAPrice = tokenAPrice;
      if (tokenBPrice !== "0") lastTokenBPrice = tokenBPrice;

      const { tokenABalance, tokenBBalance, lpTokenTotalSupply } = snapshot.data;

      if (!tokenABalance || !tokenBBalance || !lpTokenTotalSupply ||
          tokenABalance === "0" || tokenBBalance === "0" || lpTokenTotalSupply === "0") {
        return;
      }

      if (tokenAPrice === "0" || tokenBPrice === "0") {
        return;
      }

      const lpTokenPrice = calculateLPTokenPrice(
        tokenABalance,
        tokenBBalance,
        tokenAPrice,
        tokenBPrice,
        lpTokenTotalSupply
      );

      if (!hourlyLPPrices.has(hourKey) || timestamp > hourlyLPPrices.get(hourKey)!.blockTimestamp) {
        hourlyLPPrices.set(hourKey, {
          id: `lp-${timestamp.getTime()}`,
          timestamp: timestamp,
          asset: lpTokenAddress,
          price: lpTokenPrice,
          blockTimestamp: timestamp
        });
      }
    });

    if (hourlyLPPrices.size === 0) {
      console.log(`[getLPTokenPriceHistory] No LP token price data found for ${lpTokenAddress}`);
      return { data: [], totalCount: 0 };
    }

    const filledPriceHistory = forwardFillPriceHistory(hourlyLPPrices, lpTokenAddress);

    return { data: filledPriceHistory, totalCount: filledPriceHistory.length };
  } catch (error) {
    console.error('Error fetching LP token price history:', error);
    throw new Error('Failed to fetch LP token price history');
  }
};
