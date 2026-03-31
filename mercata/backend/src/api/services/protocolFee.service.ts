/**
 * Protocol Fee Service - Centralized service for tracking protocol revenues across all Mercata protocols
 */

import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getCDPRegistry } from "./cdp.service";
import { getPool } from "./lending.service";
import { getPrice } from "./oracle.service";
import * as config from "../../config/config";

const {
  CDPEngine,
  LendingPool,
  Token,
  PriceOracle,
  LendingRegistry,
  CDPRegistry,
  PoolFactory,
  Pool,
  poolFactory,
  StablePool,
  MetalForge,
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
  pendingRevenue?: string;
  lastAccrual?: number;
}

export interface AggregatedProtocolRevenue {
  totalRevenue: string;
  byProtocol: {
    cdp: ProtocolRevenue;
    lending: ProtocolRevenue;
    swap: ProtocolRevenue;
    stablePool: ProtocolRevenue;
    metalForge: ProtocolRevenue;
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
 * Revenue = Σ(toCollector) from FeesRouted events
 * Pending = un-accrued stability fees across all collateral assets since their lastAccrual
 */
export const getCDPProtocolRevenue = async (
  accessToken: string,
  userAddress: string
): Promise<ProtocolRevenue> => {
  try {
    const registry = await getCDPRegistry(accessToken, userAddress, {}, "getCDPProtocolRevenue");

    if (!registry?.cdpEngine) {
      throw new Error("CDP Engine not found");
    }
    const cdpEngineAddress = registry.cdpEngine.address;

    // Fetch FeesRouted events and CDPEngine state in parallel
    const [{ data: feesRoutedEvents }, { data: engineData }] = await Promise.all([
      cirrus.get(accessToken, `/${CDPEngine}-FeesRouted`, {
        params: {
          select: "asset,toCollector::text,block_timestamp",
          address: `eq.${cdpEngineAddress}`
        }
      }),
      cirrus.get(accessToken, `/${CDPEngine}`, {
        params: {
          address: `eq.${cdpEngineAddress}`,
          select: `feeToReserveBps::text,collateralConfigs:${CDPEngine}-collateralConfigs(asset:key,CollateralConfig:value),collateralGlobalStates:${CDPEngine}-collateralGlobalStates(asset:key,CollateralGlobalState:value)`
        }
      })
    ]);

    const timeCutoffs = getTimeCutoffs();
    const { now } = timeCutoffs;
    const RAY = 10n ** 27n;
    const usdstAddress = constants.USDST.toLowerCase();

    // FeesRouted revenue (already realized)
    const transformedEvents = (feesRoutedEvents || []).map((event: any) => ({
      value: BigInt(event.toCollector || "0"),
      timestamp: parseTimestamp(event.block_timestamp),
      asset: usdstAddress
    }));

    const periodRevenue = categorizeRevenueByPeriod(transformedEvents, timeCutoffs);

    // Compute pending (un-accrued) stability fees across all assets
    const engine = engineData?.[0];
    const feeToReserveBps = BigInt(engine?.feeToReserveBps || "0");
    const collectorShareBps = 10000n - feeToReserveBps;
    let pendingRevenue = 0n;
    let mostRecentAccrual = 0;

    if (engine) {
      const configs: any[] = engine.collateralConfigs || [];
      const states: any[] = engine.collateralGlobalStates || [];

      const configByAsset = new Map<string, any>();
      for (const c of configs) {
        const asset = (c.asset ?? "").toLowerCase();
       if (asset) configByAsset.set(asset, c.CollateralConfig);
      }

      const rpow = (x: bigint, n: bigint, base: bigint): bigint => {
        let z = n % 2n !== 0n ? x : base;
        let xC = x;
        for (let nC = n / 2n; nC !== 0n; nC = nC / 2n) {
          xC = (xC * xC) / base;
          if (nC % 2n !== 0n) z = (z * xC) / base;
        }
        return z;
      };

      for (const s of states) {
        const asset = (s.asset ?? "").toLowerCase();
        const globalState = s.CollateralGlobalState;
        if (!asset || !globalState) continue;

        const rateAccumulator = BigInt(globalState.rateAccumulator || "0");
        const lastAccrual = BigInt(globalState.lastAccrual || "0");
        const totalScaledDebt = BigInt(globalState.totalScaledDebt || "0");

        if (totalScaledDebt === 0n || rateAccumulator === 0n) continue;

        const config = configByAsset.get(asset);
        const stabilityFeeRate = BigInt(config?.stabilityFeeRate || "0");
        if (stabilityFeeRate <= RAY) continue;

        const dt = BigInt(now) - lastAccrual;
        if (dt <= 0n) continue;

        if (Number(lastAccrual) > mostRecentAccrual) {
          mostRecentAccrual = Number(lastAccrual);
        }

        const factor = rpow(stabilityFeeRate, dt, RAY);
        const newRate = (rateAccumulator * factor) / RAY;
        const feeUSD = (totalScaledDebt * (newRate - rateAccumulator)) / RAY;
        const toCollector = (feeUSD * collectorShareBps) / 10000n;
        pendingRevenue += toCollector;
      }
    }

    const calculateTotal = (revenueMap: Record<string, bigint>): string => {
      return Object.values(revenueMap).reduce((sum, val) => sum + val, 0n).toString();
    };

    const tokenSymbolCache = new Map<string, string>();
    const [allTimeArray, dailyArray, weeklyArray, monthlyArray, ytdArray] = await Promise.all([
      buildRevenueArray(accessToken, periodRevenue.allTime, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.daily, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.weekly, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.monthly, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.ytd, tokenSymbolCache)
    ]);

    return {
      totalRevenue: calculateTotal(periodRevenue.allTime),
      revenueByPeriod: {
        daily: { total: calculateTotal(periodRevenue.daily), byAsset: dailyArray },
        weekly: { total: calculateTotal(periodRevenue.weekly), byAsset: weeklyArray },
        monthly: { total: calculateTotal(periodRevenue.monthly), byAsset: monthlyArray },
        ytd: { total: calculateTotal(periodRevenue.ytd), byAsset: ytdArray },
        allTime: { total: calculateTotal(periodRevenue.allTime), byAsset: allTimeArray }
      },
      pendingRevenue: pendingRevenue.toString(),
      lastAccrual: mostRecentAccrual
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
 *
 * Revenue[T1,T2] = treasuryShare of (reservesAccrued@T2 − reservesAccrued@T1) + Σ(ReservesSweptTreasury)
 *
 * Pending revenue = un-accrued interest since lastAccrual, computed via rpow off-chain.
 */
export const getLendingProtocolRevenue = async (
  accessToken: string,
): Promise<ProtocolRevenue> => {
  try {
    const { lendingPool: lendingPoolAddress } = await getPool(accessToken, {
      select: "lendingPool"
    });

    if (!lendingPoolAddress) {
      throw new Error("Lending pool address not found");
    }

    const RAY = 10n ** 27n;
    const timeCutoffs = getTimeCutoffs();
    const { now, oneDayAgo, oneWeekAgo, oneMonthAgo, ytdCutoff } = timeCutoffs;
    const toIso = (ts: number) => new Date(ts * 1000).toISOString();

    const getReservesAccruedAt = async (isoTimestamp: string): Promise<bigint> => {
      try {
        const { data } = await cirrus.get(accessToken, "/history@storage", {
          params: {
            address: `eq.${lendingPoolAddress}`,
            valid_from: `lte.${isoTimestamp}`,
            valid_to: `gte.${isoTimestamp}`,
            select: "data"
          }
        });
        return BigInt(data?.[0]?.data?.reservesAccrued || "0");
      } catch {
        return 0n;
      }
    };

    // Fetch all snapshots, sweep events, and pool state in parallel
    const [nowReserves, dailyStart, weeklyStart, monthlyStart, ytdStart,
      sweptTreasuryRes, poolData] = await Promise.all([
      getReservesAccruedAt(toIso(now)),
      getReservesAccruedAt(toIso(oneDayAgo)),
      getReservesAccruedAt(toIso(oneWeekAgo)),
      getReservesAccruedAt(toIso(oneMonthAgo)),
      getReservesAccruedAt(toIso(ytdCutoff)),
      cirrus.get(accessToken, `/${LendingPool}-ReservesSweptTreasury`, {
        params: {
          address: `eq.${lendingPoolAddress}`,
          select: "amount::text,block_timestamp"
        }
      }),
      cirrus.get(accessToken, `/${LendingPool}`, {
        params: {
          address: `eq.${lendingPoolAddress}`,
          select: "borrowableAsset,borrowIndex::text,lastAccrual::text,totalScaledDebt::text,safetyShareBps::text,assetConfigs:BlockApps-LendingPool-assetConfigs(asset:key,AssetConfig:value)"
        }
      })
    ]);

    const safetyShareBps = BigInt(poolData.data?.[0]?.safetyShareBps || "0");
    const treasuryShareBps = 10000n - safetyShareBps;

    // Only treasury swept events count as revenue
    interface SweptEvent { amount: bigint; timestamp: number }
    const sweptEvents: SweptEvent[] = (sweptTreasuryRes.data || []).map((e: any) => ({
      amount: BigInt(e.amount || "0"),
      timestamp: parseTimestamp(e.block_timestamp)
    }));

    const sweptByPeriod = { daily: 0n, weekly: 0n, monthly: 0n, ytd: 0n, allTime: 0n };
    for (const e of sweptEvents) {
      sweptByPeriod.allTime += e.amount;
      if (e.timestamp >= oneDayAgo) sweptByPeriod.daily += e.amount;
      if (e.timestamp >= oneWeekAgo) sweptByPeriod.weekly += e.amount;
      if (e.timestamp >= oneMonthAgo) sweptByPeriod.monthly += e.amount;
      if (e.timestamp >= ytdCutoff) sweptByPeriod.ytd += e.amount;
    }

    // Treasury revenue = treasury share of delta(reservesAccrued) + swept treasury
    const calc = (startRes: bigint, swept: bigint): bigint => {
      const delta = nowReserves - startRes;
      const treasuryDelta = (delta * treasuryShareBps) / 10000n;
      const rev = treasuryDelta + swept;
      return rev > 0n ? rev : 0n;
    };

    const dailyRevenue = calc(dailyStart, sweptByPeriod.daily);
    const weeklyRevenue = calc(weeklyStart, sweptByPeriod.weekly);
    const monthlyRevenue = calc(monthlyStart, sweptByPeriod.monthly);
    const ytdRevenue = calc(ytdStart, sweptByPeriod.ytd);
    const allTimeRevenue = calc(0n, sweptByPeriod.allTime);

    // Compute pending (un-accrued) revenue since lastAccrual
    const pool = poolData.data?.[0];
    const borrowableAsset = pool?.borrowableAsset || constants.USDST;
    let pendingRevenue = 0n;
    let lastAccrualTs = 0;

    if (pool) {
      const borrowIndex = BigInt(pool.borrowIndex || "0");
      const lastAccrual = BigInt(pool.lastAccrual || "0");
      const totalScaledDebt = BigInt(pool.totalScaledDebt || "0");

      lastAccrualTs = Number(lastAccrual);
      const borrowableConfig = pool.assetConfigs?.find(
        (c: any) => (c.asset ?? c.key)?.toLowerCase() === borrowableAsset.toLowerCase()
      );
      const assetConfig = borrowableConfig?.AssetConfig ?? borrowableConfig?.value;
      const perSecondFactorRAY = BigInt(assetConfig?.perSecondFactorRAY || "0");
      const reserveFactor = BigInt(assetConfig?.reserveFactor || "0");

      if (perSecondFactorRAY > 0n && totalScaledDebt > 0n && borrowIndex > 0n) {
        const dt = BigInt(now) - lastAccrual;
        if (dt > 0n) {
          const rpow = (x: bigint, n: bigint, base: bigint): bigint => {
            let z = n % 2n !== 0n ? x : base;
            let xC = x;
            for (let nC = n / 2n; nC !== 0n; nC = nC / 2n) {
              xC = (xC * xC) / base;
              if (nC % 2n !== 0n) z = (z * xC) / base;
            }
            return z;
          };
          const projectedIndex = (borrowIndex * rpow(perSecondFactorRAY, dt, RAY)) / RAY;
          const interestDelta = (totalScaledDebt * (projectedIndex - borrowIndex)) / RAY;
          const totalPending = (interestDelta * reserveFactor) / 10000n;
          pendingRevenue = (totalPending * treasuryShareBps) / 10000n;
        }
      }
    }

    const tokenInfo = await getTokenInfo(accessToken, borrowableAsset);

    const buildByAsset = (revenue: bigint): RevenueByAsset[] => {
      if (revenue <= 0n) return [];
      return [{ asset: borrowableAsset, symbol: tokenInfo.symbol, revenue: revenue.toString() }];
    };

    return {
      totalRevenue: allTimeRevenue.toString(),
      revenueByPeriod: {
        daily: { total: dailyRevenue.toString(), byAsset: buildByAsset(dailyRevenue) },
        weekly: { total: weeklyRevenue.toString(), byAsset: buildByAsset(weeklyRevenue) },
        monthly: { total: monthlyRevenue.toString(), byAsset: buildByAsset(monthlyRevenue) },
        ytd: { total: ytdRevenue.toString(), byAsset: buildByAsset(ytdRevenue) },
        allTime: { total: allTimeRevenue.toString(), byAsset: buildByAsset(allTimeRevenue) }
      },
      pendingRevenue: pendingRevenue.toString(),
      lastAccrual: lastAccrualTs
    };
  } catch (error: any) {
    console.error("Error fetching lending protocol revenue:", {
      error: error.response?.data || error.message
    });
    throw new Error("Failed to fetch lending protocol revenue");
  }
};

/**
 * Get protocol revenue from swap operations for non-stable pools
 */
export const getSwapProtocolRevenue = async (
  accessToken: string,
): Promise<ProtocolRevenue> => {
  try {
    // Get fee collector address
    const feeCollector = await getSwapFeeCollector(accessToken);
    
    // Get only non-stable (volatile) pools belonging to our PoolFactory
    const { data: volatilePoolsData } = await cirrus.get(accessToken, `/${Pool}`, {
      params: {
        isStable: "eq.false",
        poolFactory: `eq.${poolFactory}`,
        select: "address"
      }
    });
    
    if (!volatilePoolsData || volatilePoolsData.length === 0) {
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
    
    const poolAddresses = volatilePoolsData.map((entry: any) => entry.address);
    
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
    
    // Get unique token addresses from events
    const uniqueTokenAddresses: string[] = [...new Set<string>(tokenTransferEvents.map((event: any) => event.address.toLowerCase()))];
    
    // Fetch prices for all tokens in parallel
    const priceMap = new Map<string, bigint>();
    await Promise.all(
      uniqueTokenAddresses.map(async (tokenAddress: string) => {
        try {
          const priceData = await getPrice(accessToken, tokenAddress) as { asset: string; price: string };
          priceMap.set(tokenAddress, BigInt(priceData.price));
        } catch (error) {
          console.warn(`Price not found for token ${tokenAddress}, using 0`);
          priceMap.set(tokenAddress, 0n);
        }
      })
    );
    
    // Transform events to common format, multiplying value by price
    // value is in token units (18 decimals), price is in 18 decimals
    // result = value * price / 1e18 (to avoid double scaling)
    const DECIMALS = 10n ** 18n;
    const transformedEvents = tokenTransferEvents.map((event: any) => {
      const tokenAddress = event.address.toLowerCase();
      const rawValue = BigInt(event.attributes?.value || "0");
      const price = priceMap.get(tokenAddress) || 0n;
      const valueInUsd = (rawValue * price) / DECIMALS;
      
      return {
        value: valueInUsd,
        timestamp: parseTimestamp(event.block_timestamp),
        asset: tokenAddress // The token that emitted the Transfer event
      };
    });
    
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
 * Get protocol revenue from stable pool operations
 *
 * Revenue[T1,T2] = (adminBalances at T2 − adminBalances at T1) + Σ Transfer events in [T1,T2]
 *
 * Uses history@mapping for point-in-time snapshots of adminBalances.
 * For allTime, T1 balances are 0 (empty map).
 */
export const getStablePoolProtocolRevenue = async (
  accessToken: string,
): Promise<ProtocolRevenue> => {
  try {
    const feeCollector = await getSwapFeeCollector(accessToken);

    const { data: stablePoolsData } = await cirrus.get(accessToken, `/${StablePool}`, {
      params: {
        poolFactory: `eq.${poolFactory}`,
        select: "address"
      }
    });

    const emptyRevenue: ProtocolRevenue = {
      totalRevenue: "0",
      revenueByPeriod: {
        daily: { total: "0", byAsset: [] },
        weekly: { total: "0", byAsset: [] },
        monthly: { total: "0", byAsset: [] },
        ytd: { total: "0", byAsset: [] },
        allTime: { total: "0", byAsset: [] }
      }
    };

    if (!stablePoolsData || stablePoolsData.length === 0) {
      return emptyRevenue;
    }

    const stablePoolAddresses: string[] = stablePoolsData.map((e: any) => e.address);
    const poolFilter = `in.(${stablePoolAddresses.join(",")})`;
    const timeCutoffs = getTimeCutoffs();
    const { oneDayAgo, oneWeekAgo, oneMonthAgo, ytdCutoff } = timeCutoffs;
    const toIso = (ts: number) => new Date(ts * 1000).toISOString();

    // Point-in-time snapshot of adminBalances across all stable pools, summed by token
    const getAdminBalancesAt = async (isoTimestamp: string): Promise<Map<string, bigint>> => {
      const { data } = await cirrus.get(accessToken, "/history@mapping", {
        params: {
          address: poolFilter,
          collection_name: "eq.adminBalances",
          valid_from: `lte.${isoTimestamp}`,
          valid_to: `gte.${isoTimestamp}`,
          select: "key->>key,value::text"
        }
      });
      const map = new Map<string, bigint>();
      for (const row of (data || [])) {
        const token = String(row["key->>key"] ?? row.key ?? "").toLowerCase();
        if (!token) continue;
        const rawVal = String(row.value ?? row["value::text"] ?? "0").trim();
        let val: bigint;
        try { val = BigInt(rawVal || "0"); } catch { val = 0n; }
        if (val > 0n) map.set(token, (map.get(token) || 0n) + val);
      }
      return map;
    };

    // Fetch all snapshots and Transfer events in parallel
    const [nowBalances, dailyStartBal, weeklyStartBal, monthlyStartBal, ytdStartBal, transferRes] =
      await Promise.all([
        getAdminBalancesAt(toIso(timeCutoffs.now)),
        getAdminBalancesAt(toIso(oneDayAgo)),
        getAdminBalancesAt(toIso(oneWeekAgo)),
        getAdminBalancesAt(toIso(oneMonthAgo)),
        getAdminBalancesAt(toIso(ytdCutoff)),
        cirrus.get(accessToken, `/event`, {
          params: {
            event_name: "eq.Transfer",
            select: "address,attributes,block_timestamp",
            "attributes->>from": poolFilter,
            "attributes->>to": `eq.${feeCollector}`,
            order: "block_timestamp.desc"
          }
        })
      ]);

    const transferEvents: any[] = transferRes.data || [];

    // Bucket Transfer events by period and token (raw token amounts)
    const emptyBucket = () => new Map<string, bigint>();
    const transferBuckets = {
      daily: emptyBucket(), weekly: emptyBucket(), monthly: emptyBucket(),
      ytd: emptyBucket(), allTime: emptyBucket()
    };

    for (const event of transferEvents) {
      const token = event.address?.toLowerCase();
      if (!token) continue;
      const rawAmount = event.attributes?.value;
      const amount = BigInt(rawAmount || "0");
      if (amount === 0n) continue;
      const ts = parseTimestamp(event.block_timestamp);

      transferBuckets.allTime.set(token, (transferBuckets.allTime.get(token) || 0n) + amount);
      if (ts >= oneDayAgo) transferBuckets.daily.set(token, (transferBuckets.daily.get(token) || 0n) + amount);
      if (ts >= oneWeekAgo) transferBuckets.weekly.set(token, (transferBuckets.weekly.get(token) || 0n) + amount);
      if (ts >= oneMonthAgo) transferBuckets.monthly.set(token, (transferBuckets.monthly.get(token) || 0n) + amount);
      if (ts >= ytdCutoff) transferBuckets.ytd.set(token, (transferBuckets.ytd.get(token) || 0n) + amount);
    }

    // Revenue[T1,T2] = (adminBal@T2 − adminBal@T1) + transfers in [T1,T2]
    const computePeriodRevenue = (
      startBal: Map<string, bigint>,
      endBal: Map<string, bigint>,
      transfers: Map<string, bigint>,
      priceMap: Map<string, bigint>
    ): Record<string, bigint> => {
      const DECIMALS = 10n ** 18n;
      const allTokens = new Set([...startBal.keys(), ...endBal.keys(), ...transfers.keys()]);
      const result: Record<string, bigint> = {};
      for (const token of allTokens) {
        const delta = (endBal.get(token) || 0n) - (startBal.get(token) || 0n);
        const swept = transfers.get(token) || 0n;
        const rawRevenue = delta + swept;
        if (rawRevenue <= 0n) continue;
        const price = priceMap.get(token) || 0n;
        const usdRevenue = (rawRevenue * price) / DECIMALS;
        if (usdRevenue > 0n) result[token] = usdRevenue;
      }
      return result;
    };

    // Collect all token addresses for price lookup
    const tokenSet = new Set<string>();
    for (const m of [nowBalances, dailyStartBal, weeklyStartBal, monthlyStartBal, ytdStartBal,
      transferBuckets.daily, transferBuckets.weekly, transferBuckets.monthly,
      transferBuckets.ytd, transferBuckets.allTime]) {
      for (const k of m.keys()) tokenSet.add(k);
    }

    if (tokenSet.size === 0) return emptyRevenue;

    const priceMap = new Map<string, bigint>();
    await Promise.all(
      [...tokenSet].map(async (tokenAddress) => {
        try {
          const priceData = await getPrice(accessToken, tokenAddress) as { asset: string; price: string };
          priceMap.set(tokenAddress, BigInt(priceData.price || "0"));
        } catch {
          priceMap.set(tokenAddress, 0n);
        }
      })
    );

    const emptyMap = new Map<string, bigint>();
    const periodRevenue = {
      daily: computePeriodRevenue(dailyStartBal, nowBalances, transferBuckets.daily, priceMap),
      weekly: computePeriodRevenue(weeklyStartBal, nowBalances, transferBuckets.weekly, priceMap),
      monthly: computePeriodRevenue(monthlyStartBal, nowBalances, transferBuckets.monthly, priceMap),
      ytd: computePeriodRevenue(ytdStartBal, nowBalances, transferBuckets.ytd, priceMap),
      allTime: computePeriodRevenue(emptyMap, nowBalances, transferBuckets.allTime, priceMap),
    };

    const tokenSymbolCache = new Map<string, string>();
    const [allTimeArray, dailyArray, weeklyArray, monthlyArray, ytdArray] = await Promise.all([
      buildRevenueArray(accessToken, periodRevenue.allTime, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.daily, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.weekly, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.monthly, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.ytd, tokenSymbolCache)
    ]);

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
    console.error("Error fetching stable pool protocol revenue:", {
      error: error.response?.data || error.message,
      stack: error.stack
    });
    throw new Error("Failed to fetch stable pool protocol revenue");
  }
};

/**
 * Get gas cost revenue from STRATO transaction fees (0.01 USDST per tx)
 */
export const getGasCostRevenue = async (
  accessToken: string,
): Promise<ProtocolRevenue> => {
  try {
    const GAS_FEE_WEI = "10000000000000000"; // 1e16 = 0.01 USDST
    const usdstAddress = constants.USDST.toLowerCase();
    const feeCollector = await getSwapFeeCollector(accessToken);

    // Query USDST Transfer events to feeCollector with exactly 0.01 USDST value (gas fee payments)
    const { data: gasTransferEvents } = await cirrus.get(accessToken, `/event`, {
      params: {
        event_name: "eq.Transfer",
        address: `eq.${usdstAddress}`,
        "attributes->>to": `eq.${feeCollector}`,
        "attributes->>value": `eq.${GAS_FEE_WEI}`,
        select: "block_timestamp",
        order: "block_timestamp.desc"
      }
    });
    
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
    const fee = BigInt(GAS_FEE_WEI);
    const { oneDayAgo, oneWeekAgo, oneMonthAgo, ytdCutoff } = getTimeCutoffs();

    // Count events per period — each event is exactly 0.01 USDST
    let daily = 0n, weekly = 0n, monthly = 0n, ytd = 0n, allTime = 0n;
    for (const event of gasTransferEvents) {
      const ts = parseTimestamp(event.block_timestamp);
      allTime += fee;
      if (ts >= oneDayAgo) daily += fee;
      if (ts >= oneWeekAgo) weekly += fee;
      if (ts >= oneMonthAgo) monthly += fee;
      if (ts >= ytdCutoff) ytd += fee;
    }

    const buildByAsset = (total: bigint): RevenueByAsset[] =>
      total > 0n ? [{ asset: usdstAddress, symbol: "USDST", revenue: total.toString() }] : [];

    return {
      totalRevenue: allTime.toString(),
      revenueByPeriod: {
        daily: { total: daily.toString(), byAsset: buildByAsset(daily) },
        weekly: { total: weekly.toString(), byAsset: buildByAsset(weekly) },
        monthly: { total: monthly.toString(), byAsset: buildByAsset(monthly) },
        ytd: { total: ytd.toString(), byAsset: buildByAsset(ytd) },
        allTime: { total: allTime.toString(), byAsset: buildByAsset(allTime) }
      }
    };
  } catch (error: any) {
    console.error("Error fetching gas cost revenue:", {
      error: error.response?.data || error.message
    });
    throw new Error("Failed to fetch gas cost revenue");
  }
};

/**
 * Get protocol revenue from MetalForge mint fees
 * Revenue = Σ(feeAmount) from MetalMinted events, converted to USD
 */
export const getMetalForgeProtocolRevenue = async (
  accessToken: string,
): Promise<ProtocolRevenue> => {
  try {
    const metalForgeAddress = constants.metalForge;

    const emptyRevenue: ProtocolRevenue = {
      totalRevenue: "0",
      revenueByPeriod: {
        daily: { total: "0", byAsset: [] },
        weekly: { total: "0", byAsset: [] },
        monthly: { total: "0", byAsset: [] },
        ytd: { total: "0", byAsset: [] },
        allTime: { total: "0", byAsset: [] }
      }
    };

    if (!metalForgeAddress) return emptyRevenue;

    const { data: mintEvents } = await cirrus.get(accessToken, `/${MetalForge}-MetalMinted`, {
      params: {
        address: `eq.${metalForgeAddress}`,
        select: "payToken,feeAmount::text,block_timestamp",
        order: "block_timestamp.desc"
      }
    });

    if (!mintEvents || mintEvents.length === 0) return emptyRevenue;

    const timeCutoffs = getTimeCutoffs();
    const { oneDayAgo, oneWeekAgo, oneMonthAgo, ytdCutoff } = timeCutoffs;
    const DECIMALS = 10n ** 18n;

    // Get unique pay tokens and fetch prices
    const payTokens = [...new Set<string>(mintEvents.map((e: any) => (e.payToken as string).toLowerCase()))];
    const priceMap = new Map<string, bigint>();
    await Promise.all(
      payTokens.map(async (tokenAddress) => {
        try {
          const priceData = await getPrice(accessToken, tokenAddress) as { asset: string; price: string };
          priceMap.set(tokenAddress, BigInt(priceData.price || "0"));
        } catch {
          priceMap.set(tokenAddress, 0n);
        }
      })
    );

    // Transform events: convert feeAmount to USD using payToken price
    const transformedEvents = mintEvents.map((event: any) => {
      const payToken = (event.payToken as string).toLowerCase();
      const feeAmount = BigInt(event.feeAmount || "0");
      const price = priceMap.get(payToken) || 0n;
      return {
        value: (feeAmount * price) / DECIMALS,
        timestamp: parseTimestamp(event.block_timestamp),
        asset: payToken
      };
    });

    const periodRevenue = categorizeRevenueByPeriod(transformedEvents, timeCutoffs);

    const tokenSymbolCache = new Map<string, string>();
    const [allTimeArray, dailyArray, weeklyArray, monthlyArray, ytdArray] = await Promise.all([
      buildRevenueArray(accessToken, periodRevenue.allTime, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.daily, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.weekly, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.monthly, tokenSymbolCache),
      buildRevenueArray(accessToken, periodRevenue.ytd, tokenSymbolCache)
    ]);

    const calculateTotal = (revenueMap: Record<string, bigint>): string =>
      Object.values(revenueMap).reduce((sum, val) => sum + val, 0n).toString();

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
    console.error("Error fetching metal forge protocol revenue:", {
      error: error.response?.data || error.message
    });
    throw new Error("Failed to fetch metal forge protocol revenue");
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
    const [cdpRevenue, lendingRevenue, swapRevenue, stablePoolRevenue, metalForgeRevenue, gasRevenue] = await Promise.all([
      getCDPProtocolRevenue(accessToken, userAddress),
      getLendingProtocolRevenue(accessToken),
      getSwapProtocolRevenue(accessToken),
      getStablePoolProtocolRevenue(accessToken),
      getMetalForgeProtocolRevenue(accessToken),
      getGasCostRevenue(accessToken)
    ]);

    const allProtocols = [cdpRevenue, lendingRevenue, swapRevenue, stablePoolRevenue, metalForgeRevenue, gasRevenue];
    
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
    
    const totalRevenue = allProtocols
      .reduce((sum, p) => sum + BigInt(p.totalRevenue), 0n)
      .toString();
    
    const periods: (keyof RevenueByPeriod)[] = ['daily', 'weekly', 'monthly', 'ytd', 'allTime'];
    const aggregated = {} as RevenueByPeriod;
    for (const period of periods) {
      aggregated[period] = {
        total: allProtocols
          .reduce((sum, p) => sum + BigInt(p.revenueByPeriod[period].total), 0n)
          .toString(),
        byAsset: aggregateRevenues(
          ...allProtocols.map(p => p.revenueByPeriod[period].byAsset)
        )
      };
    }
    
    return {
      totalRevenue,
      byProtocol: {
        cdp: cdpRevenue,
        lending: lendingRevenue,
        swap: swapRevenue,
        stablePool: stablePoolRevenue,
        metalForge: metalForgeRevenue,
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
  protocol?: 'cdp' | 'lending' | 'swap' | 'stablePool' | 'metalForge' | 'gas'
): Promise<RevenuePeriod> => {
  try {
    if (protocol) {
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
        case 'stablePool':
          revenue = await getStablePoolProtocolRevenue(accessToken);
          break;
        case 'metalForge':
          revenue = await getMetalForgeProtocolRevenue(accessToken);
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
