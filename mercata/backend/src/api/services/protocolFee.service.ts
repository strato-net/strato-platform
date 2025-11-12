/**
 * Protocol Fee Service - Centralized service for tracking protocol revenues across all Mercata protocols
 */

import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getCDPRegistry } from "./cdp.service";
import { getPool } from "./lending.service";
import * as config from "../../config/config";

const {
  CDPEngine,
  LendingPool,
  Token,
  PriceOracle,
  LendingRegistry,
  CDPRegistry,
  PoolFactory,
} = constants;

/**
 * Common interfaces for protocol revenue tracking
 */
export interface RevenueByAsset {
  asset: string;
  symbol: string;
  revenue: string;
}

export interface RevenuePeriod {
  total: string;
  byAsset: RevenueByAsset[];
}

export interface RevenueByPeriod {
  daily: RevenuePeriod;
  weekly: RevenuePeriod;
  monthly: RevenuePeriod;
  ytd: RevenuePeriod;
  allTime: RevenuePeriod;
}

export interface ProtocolRevenue {
  totalRevenue: string;
  revenueByPeriod: RevenueByPeriod;
}

export interface AggregatedProtocolRevenue {
  totalRevenue: string;
  byProtocol: {
    cdp: ProtocolRevenue;
    lending: ProtocolRevenue;
    swap: ProtocolRevenue;
    gas: ProtocolRevenue;
  };
  aggregated: RevenueByPeriod;
}

/**
 * Helper function to calculate time cutoffs
 */
const getTimeCutoffs = () => {
  const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds
  const oneDayAgo = now - (24 * 60 * 60);
  const oneWeekAgo = now - (7 * 24 * 60 * 60);
  const oneMonthAgo = now - (30 * 24 * 60 * 60);
  // Calculate YTD cutoff (January 1st of current year)
  const currentYear = new Date().getFullYear();
  const ytdCutoff = Math.floor(new Date(currentYear, 0, 1).getTime() / 1000);
  
  return { now, oneDayAgo, oneWeekAgo, oneMonthAgo, ytdCutoff };
};

/**
 * Helper function to get token info
 */
const getTokenInfo = async (
  accessToken: string,
  tokenAddress: string
): Promise<{ symbol: string }> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${Token}`, {
      params: {
        address: "eq." + tokenAddress,
        select: "_symbol",
      }
    });
    const token = data?.[0];
    return {
      symbol: token?._symbol || "UNKNOWN"
    };
  } catch (error) {
    console.error(`Error fetching token info for ${tokenAddress}:`, error);
    return { symbol: "UNKNOWN" };
  }
};

/**
 * Helper function to parse timestamp
 */
const parseTimestamp = (timestampStr: string): number => {
  const timestampDate = new Date(timestampStr);
  if (isNaN(timestampDate.getTime())) {
    console.error(`Invalid timestamp format: ${timestampStr}`);
    return 0;
  }
  return Math.floor(timestampDate.getTime() / 1000);
};

/**
 * Helper function to categorize revenue by time periods
 */
const categorizeRevenueByPeriod = (
  events: Array<{ value: bigint; timestamp: number; asset: string }>,
  timeCutoffs: ReturnType<typeof getTimeCutoffs>
): {
  allTime: Record<string, bigint>;
  daily: Record<string, bigint>;
  weekly: Record<string, bigint>;
  monthly: Record<string, bigint>;
  ytd: Record<string, bigint>;
} => {
  const { oneDayAgo, oneWeekAgo, oneMonthAgo, ytdCutoff } = timeCutoffs;
  
  const allTime: Record<string, bigint> = {};
  const daily: Record<string, bigint> = {};
  const weekly: Record<string, bigint> = {};
  const monthly: Record<string, bigint> = {};
  const ytd: Record<string, bigint> = {};
  
  events.forEach(({ value, timestamp, asset }) => {
    // Skip if value is 0
    if (value === 0n) return;
    
    // Track all-time
    if (!allTime[asset]) allTime[asset] = 0n;
    allTime[asset] += value;
    
    // Track by time period
    if (timestamp >= oneDayAgo) {
      if (!daily[asset]) daily[asset] = 0n;
      daily[asset] += value;
    }
    if (timestamp >= oneWeekAgo) {
      if (!weekly[asset]) weekly[asset] = 0n;
      weekly[asset] += value;
    }
    if (timestamp >= oneMonthAgo) {
      if (!monthly[asset]) monthly[asset] = 0n;
      monthly[asset] += value;
    }
    if (timestamp >= ytdCutoff) {
      if (!ytd[asset]) ytd[asset] = 0n;
      ytd[asset] += value;
    }
  });
  
  return { allTime, daily, weekly, monthly, ytd };
};

/**
 * Helper function to build revenue array with token symbols
 */
const buildRevenueArray = async (
  accessToken: string,
  revenueByAsset: Record<string, bigint>,
  tokenSymbolCache: Map<string, string> = new Map()
): Promise<RevenueByAsset[]> => {
  // Get symbols for tokens not in cache
  const newTokens = Object.keys(revenueByAsset).filter(token => !tokenSymbolCache.has(token));
  if (newTokens.length > 0) {
    const tokenInfoPromises = newTokens.map(async (token) => {
      const info = await getTokenInfo(accessToken, token);
      tokenSymbolCache.set(token, info.symbol);
      return { token, symbol: info.symbol };
    });
    await Promise.all(tokenInfoPromises);
  }
  
  // Build array with symbols
  const arr = Object.entries(revenueByAsset).map(([asset, revenue]) => ({
    asset,
    symbol: tokenSymbolCache.get(asset) || 'UNKNOWN',
    revenue: revenue.toString()
  }));
  
  // Sort by revenue descending
  arr.sort((a, b) => {
    const revenueA = BigInt(a.revenue);
    const revenueB = BigInt(b.revenue);
    if (revenueA > revenueB) return -1;
    if (revenueA < revenueB) return 1;
    return 0;
  });
  
  return arr;
};

/**
 * Get protocol revenue from CDP operations
 * Sums all toCollector values from FeesRouted events
 */
export const getCDPProtocolRevenue = async (
  accessToken: string,
  userAddress: string
): Promise<ProtocolRevenue> => {
  try {
    // Get registry to find CDPEngine address
    const registry = await getCDPRegistry(accessToken, userAddress, {}, "getCDPProtocolRevenue");
    
    if (!registry?.cdpEngine) {
      throw new Error("CDP Engine not found");
    }
    const cdpEngineAddress = registry.cdpEngine.address;
    
    // Fetch all FeesRouted events from CDPEngine
    const { data: feesRoutedEvents } = await cirrus.get(
      accessToken,
      `/${CDPEngine}-FeesRouted`,
      {
        params: {
          select: "asset,toCollector::text,block_timestamp",
          address: `eq.${cdpEngineAddress}`
        }
      }
    );

    if (!feesRoutedEvents || feesRoutedEvents.length === 0) {
      return {
        totalRevenue: "0",
        revenueByPeriod: {
          daily: { total: "0", byAsset: [] },
          weekly: { total: "0", byAsset: [] },
          monthly: { total: "0", byAsset: [] },
          ytd: { total: "0", byAsset: [] },
          allTime: { total: "0", byAsset: [] }
        }
      };
    }

    const timeCutoffs = getTimeCutoffs();
    
    // Transform events to common format
    const transformedEvents = feesRoutedEvents.map((event: any) => ({
      value: BigInt(event.toCollector || "0"),
      timestamp: parseTimestamp(event.block_timestamp),
      asset: event.asset.toLowerCase()
    }));
    
    const periodRevenue = categorizeRevenueByPeriod(transformedEvents, timeCutoffs);
    
    // Build revenue data with token symbols
    const tokenSymbolCache = new Map<string, string>();
    const [allTimeArray, dailyArray, weeklyArray, monthlyArray, ytdArray] = await Promise.all([
      buildRevenueArray(accessToken, periodRevenue.allTime, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.daily, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.weekly, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.monthly, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.ytd, tokenSymbolCache)
    ]);
    
    // Calculate totals
    const calculateTotal = (revenueMap: Record<string, bigint>): string => {
      return Object.values(revenueMap).reduce((sum, val) => sum + val, 0n).toString();
    };
    
    return {
      totalRevenue: calculateTotal(periodRevenue.allTime),
      revenueByPeriod: {
        daily: { total: calculateTotal(periodRevenue.daily), byAsset: dailyArray },
        weekly: { total: calculateTotal(periodRevenue.weekly), byAsset: weeklyArray },
        monthly: { total: calculateTotal(periodRevenue.monthly), byAsset: monthlyArray },
        ytd: { total: calculateTotal(periodRevenue.ytd), byAsset: ytdArray },
        allTime: { total: calculateTotal(periodRevenue.allTime), byAsset: allTimeArray }
      }
    };
  } catch (error: any) {
    console.error("Error fetching CDP protocol revenue:", {
      error: error.response?.data || error.message
    });
    throw new Error("Failed to fetch CDP protocol revenue");
  }
};

/**
 * Get fee collector address from LendingPool
 */
const getFeeCollector = async (
  accessToken: string,
  lendingPoolAddress: string
): Promise<string> => {
  const { data: poolData } = await cirrus.get(accessToken, `/${LendingPool}`, {
    params: { 
      address: `eq.${lendingPoolAddress}`, 
      select: "feeCollector" 
    }
  });
  
  if (!poolData || poolData.length === 0 || !poolData[0].feeCollector) {
    throw new Error("Fee collector address not found in LendingPool");
  }
  
  return poolData[0].feeCollector;
};

/**
 * Get fee collector address from PoolFactory
 */
const getSwapFeeCollector = async (
  accessToken: string
): Promise<string> => {
  const { data: factoryData } = await cirrus.get(accessToken, `/${PoolFactory}`, {
    params: { 
      address: `eq.${config.poolFactory}`, 
      select: "feeCollector" 
    }
  });
  
  if (!factoryData || factoryData.length === 0 || !factoryData[0].feeCollector) {
    throw new Error("Fee collector address not found in PoolFactory");
  }
  
  return factoryData[0].feeCollector;
};

/**
 * Get protocol revenue from lending pool operations
 */
export const getLendingProtocolRevenue = async (
  accessToken: string,
): Promise<ProtocolRevenue> => {
  try {
    // Get lending pool address from registry
    const { lendingPool: lendingPoolAddress, liquidityPool: liquidityPoolAddress } = await getPool(accessToken, { 
      select: "lendingPool,liquidityPool" 
    });
    
    if (!lendingPoolAddress || !liquidityPoolAddress) {
      throw new Error("Lending pool address not found");
    }
    
    // Get fee collector address from lending pool
    const feeCollector = await getFeeCollector(accessToken, lendingPoolAddress);
    
    // Query all Transfer events where 'from' is the lending pool and 'to' is feeCollector
    const { data: tokenTransferEvents } = await cirrus.get(accessToken, `/event`, {
      params: {
        event_name: `eq.Transfer`,
        select: "address,attributes,block_timestamp",
        "attributes->>from": `eq.${liquidityPoolAddress}`,
        "attributes->>to": `eq.${feeCollector}`,
        order: "block_timestamp.desc"
      }
    });
    
    if (!tokenTransferEvents || tokenTransferEvents.length === 0) {
      return {
        totalRevenue: "0",
        revenueByPeriod: {
          daily: { total: "0", byAsset: [] },
          weekly: { total: "0", byAsset: [] },
          monthly: { total: "0", byAsset: [] },
          ytd: { total: "0", byAsset: [] },
          allTime: { total: "0", byAsset: [] }
        }
      };
    }
    
    const timeCutoffs = getTimeCutoffs();
    
    // Transform events to common format
    const transformedEvents = tokenTransferEvents.map((event: any) => ({
      value: BigInt(event.attributes?.value || "0"),
      timestamp: parseTimestamp(event.block_timestamp),
      asset: event.address.toLowerCase() // The token that emitted the Transfer event
    }));
    
    const periodRevenue = categorizeRevenueByPeriod(transformedEvents, timeCutoffs);
    
    // Build revenue data with token symbols
    const tokenSymbolCache = new Map<string, string>();
    const [allTimeArray, dailyArray, weeklyArray, monthlyArray, ytdArray] = await Promise.all([
      buildRevenueArray(accessToken, periodRevenue.allTime, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.daily, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.weekly, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.monthly, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.ytd, tokenSymbolCache)
    ]);
    
    // Calculate totals
    const calculateTotal = (revenueMap: Record<string, bigint>): string => {
      return Object.values(revenueMap).reduce((sum, val) => sum + val, 0n).toString();
    };
    
    return {
      totalRevenue: calculateTotal(periodRevenue.allTime),
      revenueByPeriod: {
        daily: { total: calculateTotal(periodRevenue.daily), byAsset: dailyArray },
        weekly: { total: calculateTotal(periodRevenue.weekly), byAsset: weeklyArray },
        monthly: { total: calculateTotal(periodRevenue.monthly), byAsset: monthlyArray },
        ytd: { total: calculateTotal(periodRevenue.ytd), byAsset: ytdArray },
        allTime: { total: calculateTotal(periodRevenue.allTime), byAsset: allTimeArray }
      }
    };
  } catch (error: any) {
    console.error("Error fetching lending protocol revenue:", {
      error: error.response?.data || error.message
    });
    throw new Error("Failed to fetch lending protocol revenue");
  }
};

/**
 * Get protocol revenue from swap operations
 */
export const getSwapProtocolRevenue = async (
  accessToken: string,
): Promise<ProtocolRevenue> => {
  try {
    // Get fee collector address
    const feeCollector = await getSwapFeeCollector(accessToken);
    
    // Get all pools from the factory's allPools array
    const { data: allPoolsData } = await cirrus.get(accessToken, `/${PoolFactory}-allPools`, {
      params: {
        address: `eq.${config.poolFactory}`,
        select: "value"
      }
    });
    
    if (!allPoolsData || allPoolsData.length === 0) {
      return {
        totalRevenue: "0",
        revenueByPeriod: {
          daily: { total: "0", byAsset: [] },
          weekly: { total: "0", byAsset: [] },
          monthly: { total: "0", byAsset: [] },
          ytd: { total: "0", byAsset: [] },
          allTime: { total: "0", byAsset: [] }
        }
      };
    }
    
    // Extract pool addresses from the allPools array
    const poolAddresses = allPoolsData.map((entry: any) => entry.value);
    
    // Query all Transfer events where 'from' is any pool and 'to' is feeCollector
    const { data: tokenTransferEvents } = await cirrus.get(accessToken, `/event`, {
      params: {
        event_name: `eq.Transfer`,
        select: "address,attributes,block_timestamp",
        "attributes->>from": `in.(${poolAddresses.join(',')})`,
        "attributes->>to": `eq.${feeCollector}`,
        order: "block_timestamp.desc"
      }
    });
    
    if (!tokenTransferEvents || tokenTransferEvents.length === 0) {
      return {
        totalRevenue: "0",
        revenueByPeriod: {
          daily: { total: "0", byAsset: [] },
          weekly: { total: "0", byAsset: [] },
          monthly: { total: "0", byAsset: [] },
          ytd: { total: "0", byAsset: [] },
          allTime: { total: "0", byAsset: [] }
        }
      };
    }
    
    const timeCutoffs = getTimeCutoffs();
    
    // Transform events to common format
    const transformedEvents = tokenTransferEvents.map((event: any) => ({
      value: BigInt(event.attributes?.value || "0"),
      timestamp: parseTimestamp(event.block_timestamp),
      asset: event.address.toLowerCase() // The token that emitted the Transfer event
    }));
    
    const periodRevenue = categorizeRevenueByPeriod(transformedEvents, timeCutoffs);
    
    // Build revenue data with token symbols
    const tokenSymbolCache = new Map<string, string>();
    const [allTimeArray, dailyArray, weeklyArray, monthlyArray, ytdArray] = await Promise.all([
      buildRevenueArray(accessToken, periodRevenue.allTime, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.daily, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.weekly, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.monthly, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.ytd, tokenSymbolCache)
    ]);
    
    // Calculate totals
    const calculateTotal = (revenueMap: Record<string, bigint>): string => {
      return Object.values(revenueMap).reduce((sum, val) => sum + val, 0n).toString();
    };
    
    return {
      totalRevenue: calculateTotal(periodRevenue.allTime),
      revenueByPeriod: {
        daily: { total: calculateTotal(periodRevenue.daily), byAsset: dailyArray },
        weekly: { total: calculateTotal(periodRevenue.weekly), byAsset: weeklyArray },
        monthly: { total: calculateTotal(periodRevenue.monthly), byAsset: monthlyArray },
        ytd: { total: calculateTotal(periodRevenue.ytd), byAsset: ytdArray },
        allTime: { total: calculateTotal(periodRevenue.allTime), byAsset: allTimeArray }
      }
    };
  } catch (error: any) {
    console.error("Error fetching swap protocol revenue:", {
      error: error.response?.data || error.message
    });
    throw new Error("Failed to fetch swap protocol revenue");
  }
};

/**
 * Get gas cost revenue from transaction fees
 */
export const getGasCostRevenue = async (
  accessToken: string,
): Promise<ProtocolRevenue> => {
  try {
    // Get fee collector address (same as swap)
    const feeCollector = await getSwapFeeCollector(accessToken);
    
    // Query all Transfer events where 'to' is feeCollector and 'from' is not a zero/system address
    const { data: tokenTransferEvents } = await cirrus.get(accessToken, `/event`, {
      params: {
        event_name: `eq.Transfer`,
        select: "address,attributes,block_timestamp",
        "attributes->>to": `eq.${feeCollector}`,
        // Exclude transfers from zero/system addresses (000000000000000000000000000000000000%)
        "attributes->>from": `not.like.000000000000000000000000000000000000%`,
        order: "block_timestamp.desc"
      }
    });
    // Also need to exclude transfers from pools (since those are already counted in swap revenue)
    // Get all pool addresses to exclude
    const { data: allPoolsData } = await cirrus.get(accessToken, `/${PoolFactory}-allPools`, {
      params: {
        address: `eq.${config.poolFactory}`,
        select: "value"
      }
    });
    const poolAddresses = allPoolsData ? allPoolsData.map((entry: any) => entry.value) : [];
    
    // Get lending pool liquidityPool address to exclude (already counted in lending revenue)
    const { lendingPool: lendingPoolAddress, liquidityPool: liquidityPoolAddress } = await getPool(accessToken, { 
      select: "lendingPool,liquidityPool" 
    });
    
    // Filter out transfers from pools and liquidity pool
    const excludedAddresses = new Set([...poolAddresses, liquidityPoolAddress].filter(Boolean));
    const gasTransferEvents = tokenTransferEvents?.filter((event: any) => 
      !excludedAddresses.has(event.attributes.from)
    ) || [];
    
    if (!gasTransferEvents || gasTransferEvents.length === 0) {
      return {
        totalRevenue: "0",
        revenueByPeriod: {
          daily: { total: "0", byAsset: [] },
          weekly: { total: "0", byAsset: [] },
          monthly: { total: "0", byAsset: [] },
          ytd: { total: "0", byAsset: [] },
          allTime: { total: "0", byAsset: [] }
        }
      };
    }
    // Aggregate by token and time period
    const { oneDayAgo, oneWeekAgo, oneMonthAgo, ytdCutoff } = getTimeCutoffs();
    
    const revenueByAsset: Record<string, {
      symbol: string;
      daily: bigint;
      weekly: bigint;
      monthly: bigint;
      ytd: bigint;
      allTime: bigint;
    }> = {};
    
    // Process each transfer event
    for (const event of gasTransferEvents) {
      const tokenAddress = event.address;
      const amount = BigInt(event.attributes.value || "0");
      const timestamp = parseTimestamp(event.block_timestamp);
      
      // Initialize token entry if not exists
      if (!revenueByAsset[tokenAddress]) {
        const tokenInfo = await getTokenInfo(accessToken, tokenAddress);
        revenueByAsset[tokenAddress] = {
          symbol: tokenInfo.symbol,
          daily: 0n,
          weekly: 0n,
          monthly: 0n,
          ytd: 0n,
          allTime: 0n
        };
      }
      
      // Add to appropriate time buckets
      revenueByAsset[tokenAddress].allTime += amount;
      if (timestamp >= ytdCutoff) revenueByAsset[tokenAddress].ytd += amount;
      if (timestamp >= oneMonthAgo) revenueByAsset[tokenAddress].monthly += amount;
      if (timestamp >= oneWeekAgo) revenueByAsset[tokenAddress].weekly += amount;
      if (timestamp >= oneDayAgo) revenueByAsset[tokenAddress].daily += amount;
    }
    // Convert to result format
    const formatRevenueByAsset = (selector: keyof typeof revenueByAsset[string]): RevenueByAsset[] => {
      return Object.entries(revenueByAsset)
        .map(([asset, data]) => ({
          asset,
          symbol: data.symbol,
          revenue: data[selector].toString()
        }))
        .filter(item => item.revenue !== "0")
        .sort((a, b) => {
          const revenueA = BigInt(a.revenue);
          const revenueB = BigInt(b.revenue);
          if (revenueA > revenueB) return -1;
          if (revenueA < revenueB) return 1;
          return 0;
        });
    };
    // Calculate totals
    const calculateTotal = (items: RevenueByAsset[]): string => {
      return items.reduce((sum, item) => sum + BigInt(item.revenue), 0n).toString();
    };
    
    const revenueByPeriod: RevenueByPeriod = {
      daily: {
        byAsset: formatRevenueByAsset('daily'),
        total: "0"
      },
      weekly: {
        byAsset: formatRevenueByAsset('weekly'),
        total: "0"
      },
      monthly: {
        byAsset: formatRevenueByAsset('monthly'),
        total: "0"
      },
      ytd: {
        byAsset: formatRevenueByAsset('ytd'),
        total: "0"
      },
      allTime: {
        byAsset: formatRevenueByAsset('allTime'),
        total: "0"
      }
    };
    
    // Set totals
    revenueByPeriod.daily.total = calculateTotal(revenueByPeriod.daily.byAsset);
    revenueByPeriod.weekly.total = calculateTotal(revenueByPeriod.weekly.byAsset);
    revenueByPeriod.monthly.total = calculateTotal(revenueByPeriod.monthly.byAsset);
    revenueByPeriod.ytd.total = calculateTotal(revenueByPeriod.ytd.byAsset);
    revenueByPeriod.allTime.total = calculateTotal(revenueByPeriod.allTime.byAsset);
    return {
      totalRevenue: revenueByPeriod.allTime.total,
      revenueByPeriod
    };
  } catch (error: any) {
    console.error("Error fetching gas cost revenue:", {
      error: error.response?.data || error.message
    });
    throw new Error("Failed to fetch gas cost revenue");
  }
};

/**
 * Get aggregated protocol revenue across all protocols
 */
export const getAggregatedProtocolRevenue = async (
  accessToken: string,
  userAddress: string
): Promise<AggregatedProtocolRevenue> => {
  try {
    // Fetch revenue data from all protocols in parallel
    const [cdpRevenue, lendingRevenue, swapRevenue, gasRevenue] = await Promise.all([
      getCDPProtocolRevenue(accessToken, userAddress),
      getLendingProtocolRevenue(accessToken),
      getSwapProtocolRevenue(accessToken),
      getGasCostRevenue(accessToken)
    ]);
    
    // Helper to aggregate revenues across protocols
    const aggregateRevenues = (...revenues: RevenueByAsset[][]): RevenueByAsset[] => {
      const aggregated: Record<string, { symbol: string; revenue: bigint }> = {};
      
      revenues.forEach(revenueArray => {
        revenueArray.forEach(({ asset, symbol, revenue }) => {
          if (!aggregated[asset]) {
            aggregated[asset] = { symbol, revenue: 0n };
          }
          aggregated[asset].revenue += BigInt(revenue);
        });
      });
      
      return Object.entries(aggregated)
        .map(([asset, { symbol, revenue }]) => ({
          asset,
          symbol,
          revenue: revenue.toString()
        }))
        .sort((a, b) => {
          const revenueA = BigInt(a.revenue);
          const revenueB = BigInt(b.revenue);
          if (revenueA > revenueB) return -1;
          if (revenueA < revenueB) return 1;
          return 0;
        });
    };
    
    // Aggregate totals
    const totalRevenue = (
      BigInt(cdpRevenue.totalRevenue) +
      BigInt(lendingRevenue.totalRevenue) +
      BigInt(swapRevenue.totalRevenue) +
      BigInt(gasRevenue.totalRevenue)
    ).toString();
    
    // Aggregate each time period
    const aggregated: RevenueByPeriod = {
      daily: {
        total: (
          BigInt(cdpRevenue.revenueByPeriod.daily.total) +
          BigInt(lendingRevenue.revenueByPeriod.daily.total) +
          BigInt(swapRevenue.revenueByPeriod.daily.total) +
          BigInt(gasRevenue.revenueByPeriod.daily.total)
        ).toString(),
        byAsset: aggregateRevenues(
          cdpRevenue.revenueByPeriod.daily.byAsset,
          lendingRevenue.revenueByPeriod.daily.byAsset,
          swapRevenue.revenueByPeriod.daily.byAsset,
          gasRevenue.revenueByPeriod.daily.byAsset
        )
      },
      weekly: {
        total: (
          BigInt(cdpRevenue.revenueByPeriod.weekly.total) +
          BigInt(lendingRevenue.revenueByPeriod.weekly.total) +
          BigInt(swapRevenue.revenueByPeriod.weekly.total) +
          BigInt(gasRevenue.revenueByPeriod.weekly.total)
        ).toString(),
        byAsset: aggregateRevenues(
          cdpRevenue.revenueByPeriod.weekly.byAsset,
          lendingRevenue.revenueByPeriod.weekly.byAsset,
          swapRevenue.revenueByPeriod.weekly.byAsset,
          gasRevenue.revenueByPeriod.weekly.byAsset
        )
      },
      monthly: {
        total: (
          BigInt(cdpRevenue.revenueByPeriod.monthly.total) +
          BigInt(lendingRevenue.revenueByPeriod.monthly.total) +
          BigInt(swapRevenue.revenueByPeriod.monthly.total) +
          BigInt(gasRevenue.revenueByPeriod.monthly.total)
        ).toString(),
        byAsset: aggregateRevenues(
          cdpRevenue.revenueByPeriod.monthly.byAsset,
          lendingRevenue.revenueByPeriod.monthly.byAsset,
          swapRevenue.revenueByPeriod.monthly.byAsset,
          gasRevenue.revenueByPeriod.monthly.byAsset
        )
      },
      ytd: {
        total: (
          BigInt(cdpRevenue.revenueByPeriod.ytd.total) +
          BigInt(lendingRevenue.revenueByPeriod.ytd.total) +
          BigInt(swapRevenue.revenueByPeriod.ytd.total) +
          BigInt(gasRevenue.revenueByPeriod.ytd.total)
        ).toString(),
        byAsset: aggregateRevenues(
          cdpRevenue.revenueByPeriod.ytd.byAsset,
          lendingRevenue.revenueByPeriod.ytd.byAsset,
          swapRevenue.revenueByPeriod.ytd.byAsset,
          gasRevenue.revenueByPeriod.ytd.byAsset
        )
      },
      allTime: {
        total: (
          BigInt(cdpRevenue.revenueByPeriod.allTime.total) +
          BigInt(lendingRevenue.revenueByPeriod.allTime.total) +
          BigInt(swapRevenue.revenueByPeriod.allTime.total) +
          BigInt(gasRevenue.revenueByPeriod.allTime.total)
        ).toString(),
        byAsset: aggregateRevenues(
          cdpRevenue.revenueByPeriod.allTime.byAsset,
          lendingRevenue.revenueByPeriod.allTime.byAsset,
          swapRevenue.revenueByPeriod.allTime.byAsset,
          gasRevenue.revenueByPeriod.allTime.byAsset
        )
      }
    };
    
    return {
      totalRevenue,
      byProtocol: {
        cdp: cdpRevenue,
        lending: lendingRevenue,
        swap: swapRevenue,
        gas: gasRevenue
      },
      aggregated
    };
  } catch (error: any) {
    console.error("Error fetching aggregated protocol revenue:", {
      error: error.response?.data || error.message
    });
    throw new Error("Failed to fetch aggregated protocol revenue");
  }
};

/**
 * Get protocol revenue for a specific time period
 */
export const getProtocolRevenueByPeriod = async (
  accessToken: string,
  userAddress: string,
  period: 'daily' | 'weekly' | 'monthly' | 'ytd' | 'allTime',
  protocol?: 'cdp' | 'lending' | 'swap' | 'gas'
): Promise<RevenuePeriod> => {
  try {
    if (protocol) {
      // Get specific protocol revenue
      let revenue: ProtocolRevenue;
      switch (protocol) {
        case 'cdp':
          revenue = await getCDPProtocolRevenue(accessToken, userAddress);
          break;
        case 'lending':
          revenue = await getLendingProtocolRevenue(accessToken);
          break;
        case 'swap':
          revenue = await getSwapProtocolRevenue(accessToken);
          break;
        case 'gas':
          revenue = await getGasCostRevenue(accessToken);
          break;
      }
      return revenue.revenueByPeriod[period];
    } else {
      // Get aggregated revenue
      const aggregated = await getAggregatedProtocolRevenue(accessToken, userAddress);
      return aggregated.aggregated[period];
    }
  } catch (error: any) {
    console.error(`Error fetching ${protocol || 'aggregated'} protocol revenue for ${period}:`, {
      error: error.response?.data || error.message
    });
    throw new Error(`Failed to fetch protocol revenue for ${period}`);
  }
};
