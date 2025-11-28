import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { getPool } from "./lending.service";
import { PriceHistoryEntry, PriceHistoryResponse, OraclePriceEntry, OraclePriceMap } from "@mercata/shared-types";
import { toUTCTime } from "../helpers/cirrusHelpers";

const {
  PriceOracle,
  PriceOracleEvents,
  PriceOracleBatchUpdateEvents,
} = constants;

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

export const getPriceHistory = async (
  accessToken: string,
  assetAddress: string,
  rawParams: Record<string, string | undefined> = {}
): Promise<PriceHistoryResponse> => {
  try {
    // Get the oracle address from the lending registry
    const registry = await getPool(accessToken, {
      select: "priceOracle",
    });

    if (!registry.priceOracle) {
      throw new Error("Price oracle not found");
    }

    const oracleAddress = registry.priceOracle.address || registry.priceOracle;

    // Calculate time range for the last month
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const params = {
      address: `eq.${oracleAddress}`,
      block_timestamp: `gte.${toUTCTime(oneMonthAgo)}`,
      order: rawParams.order || "block_timestamp.asc",
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

    if (priceEvents.length === 0) {
      console.log(`[getPriceHistory] No data found for ${assetAddress}`);
      return { data: [], totalCount: 0 };
    }

    // Process events and create hourly data points
    const hourlyPrices = new Map<string, PriceHistoryEntry>();

    priceEvents.forEach((event: any) => {
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

    // If no historical data, return empty
    if (hourlyPrices.size === 0) {
      console.log(`[getPriceHistory] No historical oracle data found for ${assetAddress}`);
      return { data: [], totalCount: 0 };
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


    return { data: filledPriceHistory, totalCount: filledPriceHistory.length };
  } catch (error) {
    console.error('Error fetching price history:', error);
    throw new Error('Failed to fetch price history');
  }
};
