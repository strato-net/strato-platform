import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { getPool } from "./lending.service";
import { PriceHistoryEntry, PriceHistoryResponse } from "../../types";

const {
  PriceOracle,
  PriceOracleEvents,
  priceHistorySelectFields,
} = constants;

export const getPrice = async (
  accessToken: string,
  asset?: string
) => {
  const registry = await getPool(accessToken, undefined, { select: "priceOracle" });

  const prices: { asset: string; price: string }[] = registry.priceOracle
    ? registry.priceOracle.prices || []
    : [];

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
  body: Record<string, string | undefined>
) => {
  try {
    const registry = await getPool(accessToken, undefined, {
      select: "priceOracle",
    });
    const priceOracle = registry.priceOracle;
    const tx = buildFunctionTx({
      contractName: extractContractName(PriceOracle),
      contractAddress: priceOracle,
      method: "setAssetPrice",
      args: {
        asset: body.token,
        price: body.price,
      },
    });

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
    const registry = await getPool(accessToken, undefined, {
      select: "priceOracle",
    });
    
    if (!registry.priceOracle) {
      throw new Error("Price oracle not found");
    }

    const oracleAddress = registry.priceOracle.address || registry.priceOracle;

    // Calculate time range for the last month
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const oneMonthAgoISO = oneMonthAgo.toISOString();

    console.log(`[getPriceHistory] Querying events for oracle ${oracleAddress}, asset ${assetAddress}, from ${oneMonthAgoISO}`);

    const params = {
      address: `eq.${oracleAddress}`,
      asset: `eq.${assetAddress}`,
      block_timestamp: `gte.${oneMonthAgoISO}`,
      select: rawParams.select || priceHistorySelectFields.join(','),
      order: rawParams.order || 'block_timestamp.asc',
      ...Object.fromEntries(
        Object.entries(rawParams).filter(([key, value]) => 
          value !== undefined && 
          !['select', 'order'].includes(key)
        )
      )
    };

    console.log(`[getPriceHistory] Query params:`, params);

    const [priceEventsResponse, countResponse] = await Promise.all([
      cirrus.get(accessToken, `/${PriceOracleEvents}`, { params }).catch(err => {
        console.error(`[getPriceHistory] Error querying ${PriceOracleEvents}:`, err);
        return { data: [] };
      }),
      cirrus.get(accessToken, `/${PriceOracleEvents}`, { 
        params: { 
          address: `eq.${oracleAddress}`, 
          asset: `eq.${assetAddress}`,
          block_timestamp: `gte.${oneMonthAgoISO}`,
          select: 'id.count()' 
        }
      }).catch(err => {
        console.error(`[getPriceHistory] Error counting events:`, err);
        return { data: [{ count: 0 }] };
      })
    ]);

    const priceEvents = priceEventsResponse.data;
    const totalCount = countResponse.data?.[0]?.count || 0;

    console.log(`[getPriceHistory] Found ${priceEvents?.length || 0} price events for asset ${assetAddress} from ${oneMonthAgoISO}`);
    console.log(`[getPriceHistory] First few events:`, priceEvents?.slice(0, 3));

    if (!Array.isArray(priceEvents)) {
      return { data: [], totalCount: 0 };
    }

    // Process events and create hourly data points
    const hourlyPrices = new Map<string, PriceHistoryEntry>();

    priceEvents.forEach((event: any) => {
      const blockTimestamp = new Date(event.block_timestamp);
      const eventTimestamp = new Date(parseInt(event.timestamp) * 1000);
      
      // Create hourly bucket (round down to the hour)
      const hourBucket = new Date(blockTimestamp);
      hourBucket.setMinutes(0, 0, 0);
      const hourKey = hourBucket.toISOString();

      // Keep the latest price for each hour
      if (!hourlyPrices.has(hourKey) || blockTimestamp > hourlyPrices.get(hourKey)!.blockTimestamp) {
        hourlyPrices.set(hourKey, {
          id: event.id.toString(),
          timestamp: eventTimestamp,
          asset: event.asset,
          price: event.price,
          blockTimestamp: blockTimestamp
        });
      }
    });

    console.log(`[getPriceHistory] Created ${hourlyPrices.size} unique hourly price points`);

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
    
    console.log(`[getPriceHistory] Chart range: ${startTime.toISOString()} to ${endTime.toISOString()}`);
    console.log(`[getPriceHistory] Earliest data: ${earliestDataPoint.price} at ${earliestDataPoint.blockTimestamp}`);
    
    const filledPriceHistory: PriceHistoryEntry[] = [];
    let currentPrice = earliestDataPoint.price;
    
    // Generate hourly timestamps from first data point to now
    let hoursGenerated = 0;
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
          price: currentPrice,
          blockTimestamp: new Date(currentHour)
        });
      }
      hoursGenerated++;
    }

    console.log(`[getPriceHistory] Generated ${hoursGenerated} hours from first data point, returning ${filledPriceHistory.length} data points`);
    
    return { data: filledPriceHistory, totalCount: filledPriceHistory.length };
  } catch (error) {
    console.error('Error fetching price history:', error);
    throw new Error('Failed to fetch price history');
  }
};
