import { cirrus } from "../../utils/appApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { executeTransaction } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { constants } from "../../config/constants";
import * as config from "../../config/config";
import {
  calculateImpliedPrice,
  buildPoolParams,
  extractTokenAddresses,
  extractTokenAddressesFromTokens,
  buildSwapToken,
  buildPoolList,
  fetchPoolTokenAddresses,
  fetchPoolBalances,
  buildTokenApprovalTx,
  getTradingVolume24hForPools,
  getTokenBalance,
  fetchPoolCoins,
  fetchPoolTokenBalances,
  fetchTokenMetadata,
  buildPoolCoins,
  calculateMultiTokenLPPrice,
  calculateMultiTokenLiquidity,
  resolveCoinIndex,
  calculateLPFees24h,
  calculatePoolAPY,
  fetchMultiTokenStablePools,
  fetchStablePoolFees,
  MultiTokenStablePool,
  buildMultiTokenPoolEntry,
  applyStablePoolFees,
  getUserPoolLiquidityFlowTotals,
} from "../helpers/swapping.helper";
import * as stable from "../helpers/stablePoolMath.helper";
import { getOraclePrices } from "./oracle.service";
import {
  fetchPairSwapHistory as fetchV3PairSwapHistory,
  fetchTokenSwapHistory as fetchV3TokenSwapHistory,
} from "./poolV3.service";
import {
  SwapHistoryEntry,
  PoolList,
  Pool,
  SwapParams,
  LiquidityParams,
  RemoveLiquidityParams,
  SingleTokenLiquidityParams,
  MultiTokenSwapParams,
  StablePoolQuote,
  MultiTokenLiquidityParams,
  MultiTokenRemoveLiquidityParams,
  MultiTokenRemoveLiquidityOneParams,
  PoolCoin,
  SetPoolRatesParams,
  CreatePoolParams,
  TransactionResponse,
  SwapHistoryResponse,
  SwapToken,
  RawToken,
  RawGetPool,
  RawPoolFactory,
  RawSwapEvent,
  PoolWithTokens,
  PoolWithTokenA,
  PoolWithTokenB
} from "@strato/shared-types";

const { Pool: PoolTable, PoolFactory, PoolSwap, StablePool: StablePoolTable, swapHistorySelectFields, swapTokenSelectFields } = constants;

// ============================================================================
// READ OPERATIONS
// ============================================================================

const normalizeAddress = (address: string): string => address.toLowerCase().replace(/^0x/, "");

// --- Pool Queries ---

export const getPools = async (
  accessToken: string,
  userAddress: string | undefined,
  rawParams: Record<string, string | undefined> = {}
): Promise<PoolList> => {
  const params = buildPoolParams(rawParams, userAddress);

  const [{data: poolData}, { data: factoryData }] = await Promise.all([
    cirrus.get(accessToken, `/${PoolTable}`, { params }),
    cirrus.get(accessToken, `/${PoolFactory}`, {
      params: { address: "eq." + config.poolFactory, select: "swapFeeRate,lpSharePercent" }
    })
  ]);

  // Filter out hidden pools and pools with deactivated tokens (status !== 2 = ACTIVE)
  const ACTIVE_TOKEN_STATUS = "2";
  const validatedPools = (poolData as RawGetPool[]).filter(
    pool => !config.hiddenSwapPools.has(pool.address)
      && pool.tokenA.status === ACTIVE_TOKEN_STATUS
      && pool.tokenB.status === ACTIVE_TOKEN_STATUS
  );
  const validatedFactory = factoryData[0] as RawPoolFactory;
  const tokenAddresses = extractTokenAddresses(validatedPools);
  const priceMap = await getOraclePrices(accessToken, {
    select: "asset:key,price:value::text",
    key: `in.(${tokenAddresses.join(',')})`
  });
  const volumeMap = await getTradingVolume24hForPools(accessToken, validatedPools.map(pool => pool.address), priceMap);

  let userLiquidityFlowTotals: Map<string, { totalDepositedUsd: bigint; totalWithdrawnUsd: bigint }> | undefined;
  if (userAddress) {
    userLiquidityFlowTotals = await getUserPoolLiquidityFlowTotals(
      accessToken,
      validatedPools,
      userAddress,
      priceMap
    );
  }

  const poolList: any[] = buildPoolList(
    validatedPools,
    priceMap,
    volumeMap,
    validatedFactory,
    userAddress
  );

  // Replace or add multi-token stable pools. These pools also appear in the BlockApps-Pool table
  // (from Pool(pool).setFeeParameters()) but with invalid tokenA/tokenB. Replace those entries
  // with properly built multi-token pool entries.
  const multiTokenStablePools = await fetchMultiTokenStablePools(accessToken);
  await Promise.all(multiTokenStablePools.map(async (stablePool) => {
    try {
      const poolEntry = await buildMultiTokenPoolEntry(
        accessToken, stablePool, priceMap, volumeMap, validatedFactory, userAddress
      );
      const existingIdx = poolList.findIndex((p: any) => p.address === stablePool.address);
      if (existingIdx !== -1) {
        poolList[existingIdx] = poolEntry;
      } else {
        poolList.push(poolEntry);
      }
    } catch (err) {
      console.error(`Failed to build multi-token pool ${stablePool.address}:`, err);
    }
  }));

  const patchedPoolList = await applyStablePoolFees(accessToken, poolList);

  if (!userAddress) {
    return patchedPoolList;
  }

  return patchedPoolList.map((pool) => {
    const flow = userLiquidityFlowTotals?.get(pool.address.toLowerCase()) || {
      totalDepositedUsd: 0n,
      totalWithdrawnUsd: 0n,
    };
    const netInvestedUsd = flow.totalDepositedUsd - flow.totalWithdrawnUsd;

    let currentValueUsd = 0n;
    try {
      const totalBalance = BigInt(pool.lpToken?.totalBalance || "0");
      const lpPrice = BigInt(pool.lpToken?.price || "0");
      if (totalBalance > 0n && lpPrice > 0n) {
        currentValueUsd = (totalBalance * lpPrice) / (10n ** 18n);
      }
    } catch {
      currentValueUsd = 0n;
    }

    const userAllTimeEarningsUsd = currentValueUsd - netInvestedUsd;

    return {
      ...pool,
      userTotalDepositedUsd: flow.totalDepositedUsd.toString(),
      userTotalWithdrawnUsd: flow.totalWithdrawnUsd.toString(),
      userNetInvestedUsd: netInvestedUsd.toString(),
      userAllTimeEarningsUsd: userAllTimeEarningsUsd.toString(),
    };
  });
};

// --- Token Queries ---

export const getSwapableTokens = async (
  accessToken: string,
  userAddress: string
): Promise<SwapToken[]> => {
  const { data: poolData } = await cirrus.get(accessToken, `/${PoolTable}`, {
    params: {
      poolFactory: "eq." + constants.poolFactory,
      isDisabled: "eq.false",
      select: `address,tokenA:tokenA_fkey(${swapTokenSelectFields.join(',')}),tokenB:tokenB_fkey(${swapTokenSelectFields.join(',')}),tokenABalance::text,tokenBBalance::text`,
      "tokenA.balances.key": `eq.${userAddress}`,
      "tokenB.balances.key": `eq.${userAddress}`,
    }
  });

  // Filter out hidden pools and pools with deactivated tokens
  const ACTIVE_TOKEN_STATUS = "2";
  const validatedPools = (poolData as (PoolWithTokens & { address: string })[]).filter(
    pool => !config.hiddenSwapPools.has(pool.address)
      && pool.tokenA.status === ACTIVE_TOKEN_STATUS
      && pool.tokenB.status === ACTIVE_TOKEN_STATUS
  ) as PoolWithTokens[];
  const tokenAddresses = extractTokenAddresses(validatedPools);
  const priceMap = await getOraclePrices(accessToken, {
    select: "asset:key,price:value::text",
    key: `in.(${tokenAddresses.join(',')})`
  });

  const tokenMap = new Map<string, SwapToken>();

  validatedPools.forEach((pool: PoolWithTokens) => {
    [pool.tokenA, pool.tokenB].forEach((token: RawToken, index: number) => {

      if (!tokenMap.has(token.address)) {
        const price = priceMap.get(token.address) || "0";
        const poolBalance = index === 0 ? pool.tokenABalance : pool.tokenBBalance;

        tokenMap.set(token.address, buildSwapToken(token, price, poolBalance, getTokenBalance(token, userAddress)));
      }
    });
  });

  // Also include tokens from dynamically discovered multi-token pools
  const multiTokenStablePools = await fetchMultiTokenStablePools(accessToken);
  await Promise.all(multiTokenStablePools.map(async (stablePool) => {
    try {
      // Only include coins that have balance > 0 in the pool
      const fundedCoins = stablePool.coins.filter(c => {
        const balance = stablePool.tokenBalances.get(c.tokenAddress) || "0";
        return BigInt(balance) > 0n;
      });

      // Update existing tokens that have 0 poolBalance with the multi-token pool balance
      fundedCoins.forEach(c => {
        const existing = tokenMap.get(c.tokenAddress);
        if (existing && BigInt(existing.poolBalance || "0") === 0n) {
          const poolBalance = stablePool.tokenBalances.get(c.tokenAddress) || "0";
          tokenMap.set(c.tokenAddress, { ...existing, poolBalance });
        }
      });

      const coinAddresses = fundedCoins.map(c => c.tokenAddress).filter(addr => !tokenMap.has(addr));
      if (coinAddresses.length === 0) return;

      const tokenMetadataMap = await fetchTokenMetadata(accessToken, coinAddresses, userAddress);

      // Fetch prices for new tokens
      const additionalPrices = await getOraclePrices(accessToken, {
        select: "asset:key,price:value::text",
        key: `in.(${coinAddresses.join(',')})`
      });

      coinAddresses.forEach(addr => {
        const token = tokenMetadataMap.get(addr);
        if (token) {
          const price = additionalPrices.get(addr) || "0";
          const poolBalance = stablePool.tokenBalances.get(addr) || "0";
          tokenMap.set(addr, buildSwapToken(token, price, poolBalance, getTokenBalance(token, userAddress)));
        }
      });
    } catch (err) {
      console.error(`Failed to fetch multi-token pool coins for ${stablePool.address}:`, err);
    }
  }));

  return Array.from(tokenMap.values());
};

export const getSwapableTokenPairs = async (
  accessToken: string,
  tokenAddress: string,
  userAddress: string
): Promise<SwapToken[]> => {
  const [{ data: poolDataA }, { data: poolDataB }] = await Promise.all([
    cirrus.get(accessToken, `/${PoolTable}`, {
      params: {
        poolFactory: "eq." + constants.poolFactory,
        isDisabled: "eq.false",
        select: `address,tokenB:tokenB_fkey(${swapTokenSelectFields.join(',')}),tokenBBalance::text`,
        tokenA: "eq." + tokenAddress,
        "tokenB.balances.key": `eq.${userAddress}`,
      }
    }),
    cirrus.get(accessToken, `/${PoolTable}`, {
      params: {
        poolFactory: "eq." + constants.poolFactory,
        isDisabled: "eq.false",
        select: `address,tokenA:tokenA_fkey(${swapTokenSelectFields.join(',')}),tokenABalance::text`,
        tokenB: "eq." + tokenAddress,
        "tokenA.balances.key": `eq.${userAddress}`,
      }
    })
  ]);

  // Filter out hidden pools and pools with deactivated tokens
  const ACTIVE_TOKEN_STATUS = "2";
  const validatedPoolsA = (poolDataA as (PoolWithTokenB & { address: string })[]).filter(
    pool => !config.hiddenSwapPools.has(pool.address)
      && pool.tokenB.status === ACTIVE_TOKEN_STATUS
  ) as PoolWithTokenB[];
  const validatedPoolsB = (poolDataB as (PoolWithTokenA & { address: string })[]).filter(
    pool => !config.hiddenSwapPools.has(pool.address)
      && pool.tokenA.status === ACTIVE_TOKEN_STATUS
  ) as PoolWithTokenA[];

  const allTokens: Array<{token: RawToken, poolBalance: string}> = [
    ...validatedPoolsA.map(pool => ({ token: pool.tokenB, poolBalance: pool.tokenBBalance })),
    ...validatedPoolsB.map(pool => ({ token: pool.tokenA, poolBalance: pool.tokenABalance })),
  ];

  const tokenAddresses = extractTokenAddressesFromTokens(allTokens.map(item => item.token));
  const priceMap = await getOraclePrices(accessToken, {
    select: "asset:key,price:value::text",
    key: `in.(${tokenAddresses.join(',')})`
  });

  const tokenMap = new Map<string, SwapToken>();

  allTokens.forEach(({token, poolBalance}) => {
    if (!tokenMap.has(token.address)) {
      const price = priceMap.get(token.address) || "0";
      tokenMap.set(token.address, buildSwapToken(token, price, poolBalance, getTokenBalance(token, userAddress)));
    }
  });

  // For multi-token pools: if the selected token is in a multi-token pool,
  // add all other coins from that pool as pairable tokens (only if both have balance > 0)
  const multiTokenStablePools = await fetchMultiTokenStablePools(accessToken);
  for (const stablePool of multiTokenStablePools) {
    try {
      // Check if the selected token is in this pool and has balance > 0
      const selectedCoin = stablePool.coins.find(
        c => c.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
      );
      if (!selectedCoin) continue;
      const selectedBalance = stablePool.tokenBalances.get(selectedCoin.tokenAddress) || "0";
      if (BigInt(selectedBalance) === 0n) continue;

      // Add other coins that have balance > 0 as pairable tokens
      const otherFundedCoins = stablePool.coins.filter(c => {
        if (c.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()) return false;
        const balance = stablePool.tokenBalances.get(c.tokenAddress) || "0";
        return BigInt(balance) > 0n;
      });

      // Update existing tokens that have 0 poolBalance with the multi-token pool balance
      otherFundedCoins.forEach(c => {
        const existing = tokenMap.get(c.tokenAddress);
        if (existing && BigInt(existing.poolBalance || "0") === 0n) {
          const poolBalance = stablePool.tokenBalances.get(c.tokenAddress) || "0";
          tokenMap.set(c.tokenAddress, { ...existing, poolBalance });
        }
      });

      const otherCoinAddresses = otherFundedCoins
        .map(c => c.tokenAddress)
        .filter(addr => !tokenMap.has(addr));
      if (otherCoinAddresses.length === 0) continue;

      const tokenMetadataMap = await fetchTokenMetadata(accessToken, otherCoinAddresses, userAddress);

      const additionalPrices = await getOraclePrices(accessToken, {
        select: "asset:key,price:value::text",
        key: `in.(${otherCoinAddresses.join(',')})`
      });

      otherCoinAddresses.forEach(addr => {
        const token = tokenMetadataMap.get(addr);
        if (token) {
          const price = additionalPrices.get(addr) || "0";
          const poolBalance = stablePool.tokenBalances.get(addr) || "0";
          tokenMap.set(addr, buildSwapToken(token, price, poolBalance, getTokenBalance(token, userAddress)));
        }
      });
    } catch (err) {
      console.error(`Failed to fetch multi-token pool pairs for ${stablePool.address}:`, err);
    }
  }

  return Array.from(tokenMap.values());
};

// --- Analytics Queries ---

export const getSwapHistory = async (
  accessToken: string,
  poolAddress: string,
  page: number = 1,
  limit: number = 10,
  senderAddress?: string
): Promise<SwapHistoryResponse> => {
  const offset = (page - 1) * limit;
  const normalizedSenderAddress = senderAddress ? normalizeAddress(senderAddress) : undefined;

  const [swapEventsResponse, countResponse] = await Promise.all([
    cirrus.get(accessToken, `/${PoolSwap}`, {
      params: {
        address: `eq.${poolAddress}`,
        ...(normalizedSenderAddress ? { sender: `eq.${normalizedSenderAddress}` } : {}),
        select: swapHistorySelectFields.join(','),
        order: 'block_timestamp.desc',
        limit: limit.toString(),
        offset: offset.toString(),
      }
    }),
    cirrus.get(accessToken, `/${PoolSwap}`, {
      params: {
        address: `eq.${poolAddress}`,
        ...(normalizedSenderAddress ? { sender: `eq.${normalizedSenderAddress}` } : {}),
        select: "count()",
      }
    })
  ]);

  const { data: swapEvents } = swapEventsResponse;
  const totalCount = countResponse.data?.[0]?.count || 0;

  if (!Array.isArray(swapEvents)) {
    return { data: [], totalCount: 0 };
  }

  const swapHistory: SwapHistoryEntry[] = (swapEvents as RawSwapEvent[]).map(event => {
    const { tokenA, tokenB, isStable } = event.pool;
    const isAToB = event.tokenIn === tokenA.address;

    return {
      id: event.id,
      timestamp: new Date(event.block_timestamp),
      tokenIn: isAToB ? tokenA.symbol : tokenB.symbol,
      tokenOut: isAToB ? tokenB.symbol : tokenA.symbol,
      amountIn: event.amountIn,
      amountOut: event.amountOut,
      impliedPrice: calculateImpliedPrice(event.amountIn, event.amountOut, isAToB, isStable),
      sender: event.sender
    };
  });

  return { data: swapHistory, totalCount };
};

/**
 * Unified pair swap history: merges V2 swaps (filtered by tokenIn/tokenOut, so trades
 * routed through multi-token stable pools count too) with V3 swaps across all the
 * pair's fee tiers, newest first. Each source contributes its newest page×limit rows —
 * a correct merged page K only needs the top K of each source — and the counts sum.
 * Rows carry poolName ("V2" / "V3 0.3%") so the table can show the executing pool.
 * impliedPrice is normalized to tokenB-per-tokenA in the REQUESTED pair order on both
 * venues (for V2 by passing "did tokenA go in" as calculateImpliedPrice's direction).
 */
export const getPairSwapHistory = async (
  accessToken: string,
  tokenA: string,
  tokenB: string,
  page: number = 1,
  limit: number = 10,
  senderAddress?: string
): Promise<SwapHistoryResponse> => {
  const a = normalizeAddress(tokenA);
  const b = normalizeAddress(tokenB);
  const offset = (page - 1) * limit;
  const fetchCap = offset + limit;
  const normalizedSender = senderAddress ? normalizeAddress(senderAddress) : undefined;

  const v2Filters = {
    or: `(and(tokenIn.eq.${a},tokenOut.eq.${b}),and(tokenIn.eq.${b},tokenOut.eq.${a}))`,
    ...(normalizedSender ? { sender: `eq.${normalizedSender}` } : {}),
  };

  const [v2EventsResponse, v2CountResponse, symbolsResponse, v3Result] = await Promise.all([
    cirrus.get(accessToken, `/${PoolSwap}`, {
      params: {
        ...v2Filters,
        select: swapHistorySelectFields.join(','),
        order: 'block_timestamp.desc',
        limit: fetchCap.toString(),
      }
    }),
    cirrus.get(accessToken, `/${PoolSwap}`, {
      params: { ...v2Filters, select: "count()" }
    }),
    // symbols from the Token table rather than the pool embed: a multi-token stable
    // pool's tokenA/tokenB embed doesn't necessarily cover the traded pair
    cirrus.get(accessToken, `/${constants.Token}`, {
      params: { address: `in.(${a},${b})`, select: "address,_symbol" }
    }),
    // chains without V3 pools have no PoolV3 tables — pair history still works
    fetchV3PairSwapHistory(accessToken, tokenA, tokenB, fetchCap, senderAddress)
      .catch(() => ({ entries: [] as SwapHistoryEntry[], totalCount: 0 })),
  ]);

  const v2Events = Array.isArray(v2EventsResponse.data) ? v2EventsResponse.data as RawSwapEvent[] : [];
  const v2Count = v2CountResponse.data?.[0]?.count || 0;
  const symbolByAddress = new Map(
    ((symbolsResponse.data as { address: string; _symbol: string }[]) ?? [])
      .map((t) => [t.address, t._symbol])
  );

  const v2Entries: SwapHistoryEntry[] = v2Events.map(event => ({
    id: event.id,
    timestamp: new Date(event.block_timestamp),
    tokenIn: symbolByAddress.get(event.tokenIn) ?? event.tokenIn,
    tokenOut: symbolByAddress.get(event.tokenOut) ?? event.tokenOut,
    amountIn: event.amountIn,
    amountOut: event.amountOut,
    impliedPrice: calculateImpliedPrice(event.amountIn, event.amountOut, event.tokenIn === a, event.pool.isStable),
    sender: event.sender,
    poolAddress: event.address,
    poolName: event.pool.isStable ? "Stable" : "V2",
  }));

  const merged = [...v2Entries, ...v3Result.entries]
    .sort((x, y) => y.timestamp.getTime() - x.timestamp.getTime())
    .slice(offset, offset + limit);

  return { data: merged, totalCount: v2Count + v3Result.totalCount };
};

/**
 * Recent swaps involving a single token across all V2/stable pools (tokenIn or
 * tokenOut) and every V3 fee-tier pool that lists it. Newest first; same merge
 * pagination pattern as getPairSwapHistory. impliedPrice is output-per-input.
 */
export const getTokenSwapHistory = async (
  accessToken: string,
  tokenAddress: string,
  page: number = 1,
  limit: number = 10
): Promise<SwapHistoryResponse> => {
  const t = normalizeAddress(tokenAddress);
  const offset = (page - 1) * limit;
  const fetchCap = offset + limit;

  const v2Filters = {
    or: `(tokenIn.eq.${t},tokenOut.eq.${t})`,
  };

  const [v2EventsResponse, v2CountResponse, v3Result] = await Promise.all([
    cirrus.get(accessToken, `/${PoolSwap}`, {
      params: {
        ...v2Filters,
        select: swapHistorySelectFields.join(","),
        order: "block_timestamp.desc",
        limit: fetchCap.toString(),
      },
    }),
    cirrus.get(accessToken, `/${PoolSwap}`, {
      params: { ...v2Filters, select: "count()" },
    }),
    fetchV3TokenSwapHistory(accessToken, tokenAddress, fetchCap).catch(() => ({
      entries: [] as SwapHistoryEntry[],
      totalCount: 0,
    })),
  ]);

  const v2Events = Array.isArray(v2EventsResponse.data)
    ? (v2EventsResponse.data as RawSwapEvent[])
    : [];
  const v2Count = v2CountResponse.data?.[0]?.count || 0;

  const symbolAddrs = [...new Set(v2Events.flatMap((e) => [e.tokenIn, e.tokenOut]))];
  let symbolByAddress = new Map<string, string>();
  if (symbolAddrs.length > 0) {
    const symbolsResponse = await cirrus.get(accessToken, `/${constants.Token}`, {
      params: { address: `in.(${symbolAddrs.join(",")})`, select: "address,_symbol" },
    });
    symbolByAddress = new Map(
      ((symbolsResponse.data as { address: string; _symbol: string }[]) ?? []).map((row) => [
        row.address,
        row._symbol,
      ])
    );
  }

  const v2Entries: SwapHistoryEntry[] = v2Events.map((event) => ({
    id: event.id,
    timestamp: new Date(event.block_timestamp),
    tokenIn: symbolByAddress.get(event.tokenIn) ?? event.tokenIn,
    tokenOut: symbolByAddress.get(event.tokenOut) ?? event.tokenOut,
    amountIn: event.amountIn,
    amountOut: event.amountOut,
    impliedPrice: calculateImpliedPrice(event.amountIn, event.amountOut, true, event.pool.isStable),
    sender: event.sender,
    poolAddress: event.address,
    poolName: event.pool.isStable ? "Stable" : "V2",
  }));

  const merged = [...v2Entries, ...v3Result.entries]
    .sort((x, y) => y.timestamp.getTime() - x.timestamp.getTime())
    .slice(offset, offset + limit);

  return { data: merged, totalCount: v2Count + v3Result.totalCount };
};

// --- Pair Candidates (V2 + stable discovery for the unified trade surface) ---

export interface PairPoolToken {
  address: string;
  _name: string;
  _symbol: string;
  customDecimals: number | null;
  status: string;
}

/** a V2 or 2-coin stable pool that can trade the requested pair, fee resolved */
export interface PairPoolCandidate {
  address: string;
  isStable: boolean;
  isPaused: boolean;
  isDisabled: boolean;
  /** effective fee in bps: stable pools from StablePool.fee, V2 from the pool's
   *  own rate with the factory rate as fallback (mirrors Pool._swapFeeRate) */
  feeBps: number;
  tokenA: PairPoolToken;
  tokenB: PairPoolToken;
  tokenABalance: string;
  tokenBBalance: string;
  aToBRatio: string;
  bToARatio: string;
}

export interface MultiTokenPoolCandidate extends MultiTokenStablePool {
  feeBps: number;
}

export interface PairPoolCandidates {
  /** V2 + 2-coin stable pools (Pool table) */
  pools: PairPoolCandidate[];
  /** >2-coin stable pools containing both tokens, funded on both */
  multiTokenPools: MultiTokenPoolCandidate[];
}

const ACTIVE_TOKEN_STATUS = "2";

/**
 * All V2/stable pools that can trade tokenA <-> tokenB: funded, not disabled,
 * not hidden, ACTIVE tokens, with effective fees resolved. V3 discovery lives
 * in poolV3.service; trade.service composes the two.
 */
export const getPairPoolCandidates = async (
  accessToken: string,
  tokenA: string,
  tokenB: string
): Promise<PairPoolCandidates> => {
  const a = normalizeAddress(tokenA);
  const b = normalizeAddress(tokenB);

  const [pairResult, factoryResult, multiPools] = await Promise.all([
    cirrus.get(accessToken, `/${PoolTable}`, {
      params: {
        poolFactory: "eq." + constants.poolFactory,
        isDisabled: "eq.false",
        tokenA: `in.(${a},${b})`,
        tokenB: `in.(${a},${b})`,
        select: [
          "address",
          "tokenA:tokenA_fkey(address,_name,_symbol,customDecimals,status)",
          "tokenB:tokenB_fkey(address,_name,_symbol,customDecimals,status)",
          "tokenABalance::text",
          "tokenBBalance::text",
          "swapFeeRate",
          "aToBRatio::text",
          "bToARatio::text",
          "isStable",
          "isPaused",
          "isDisabled",
        ].join(","),
      },
    }),
    cirrus.get(accessToken, `/${PoolFactory}`, {
      params: { address: "eq." + config.poolFactory, select: "swapFeeRate" },
    }),
    fetchMultiTokenStablePools(accessToken),
  ]);

  const factoryFeeBps = Number((factoryResult.data as { swapFeeRate: number }[])[0]?.swapFeeRate ?? 30);

  type RawRow = Omit<PairPoolCandidate, "feeBps"> & { swapFeeRate: number };
  const rows = (pairResult.data as RawRow[]).filter(
    (row) =>
      !config.hiddenSwapPools.has(row.address) &&
      row.tokenA?.status === ACTIVE_TOKEN_STATUS &&
      row.tokenB?.status === ACTIVE_TOKEN_STATUS &&
      // both requested tokens present (the in.() filter also admits same-token rows)
      new Set([row.tokenA.address, row.tokenB.address]).size === 2 &&
      BigInt(row.tokenABalance || "0") > 0n &&
      BigInt(row.tokenBBalance || "0") > 0n
  );

  const pairAddresses = new Set(rows.map((row) => row.address));
  const matchedMultis = multiPools.filter((pool) => {
    if (pairAddresses.has(pool.address) || config.hiddenSwapPools.has(pool.address)) return false;
    if (pool.isDisabled) return false;
    const coinAddresses = pool.coins.map((c) => c.tokenAddress.toLowerCase());
    if (!coinAddresses.includes(a) || !coinAddresses.includes(b)) return false;
    return (
      BigInt(pool.tokenBalances.get(a) || "0") > 0n &&
      BigInt(pool.tokenBalances.get(b) || "0") > 0n
    );
  });

  const stableAddresses = [
    ...rows.filter((row) => row.isStable).map((row) => row.address),
    ...matchedMultis.map((pool) => pool.address),
  ];
  const stableFeeMap = stableAddresses.length > 0
    ? await fetchStablePoolFees(accessToken, stableAddresses)
    : new Map<string, number>();

  return {
    pools: rows.map((row) => ({
      ...row,
      feeBps: row.isStable
        ? stableFeeMap.get(row.address) ?? factoryFeeBps
        : row.swapFeeRate || factoryFeeBps,
    })),
    multiTokenPools: matchedMultis.map((pool) => ({
      ...pool,
      feeBps: stableFeeMap.get(pool.address) ?? factoryFeeBps,
    })),
  };
};

// --- Stable Pool Quotes ---

const ZERO_ADDRESS = "0000000000000000000000000000000000000000";

interface RawStablePoolQuoteRow {
  address: string;
  fee: string;
  offpegFeeMultiplier: string;
  initialA: string;
  futureA: string;
  initialATime: string;
  futureATime: string;
  isPaused: boolean;
  isDisabled: boolean;
  poolContainsRebasingTokens: boolean;
  coins: { key: number; value: string }[];
  tokenBalances: { key: string; value: string }[];
  adminBalances: { key: string; value: string }[];
  rateMultipliers: { key: string; value: string }[];
  rateOracles: { key: string; value: string }[];
  assetTypes: { key: number; value: string }[];
}

/**
 * Exact quote for a StablePool swap (2-coin or multi-token): replays the
 * contract's __exchange math (getD/getY + dynamic fee) over the indexed pool
 * state, so the quoted amount is bit-identical to what execution returns for
 * the same state. amountSpecified > 0 quotes exact input, < 0 exact output.
 */
export const getStableQuote = async (
  accessToken: string,
  poolAddress: string,
  tokenIn: string,
  tokenOut: string,
  amountSpecified: bigint
): Promise<StablePoolQuote> => {
  if (amountSpecified === 0n) throw new Error("Amount cannot be 0");

  const { data } = await cirrus.get(accessToken, `/${StablePoolTable}`, {
    params: {
      address: `eq.${normalizeAddress(poolAddress)}`,
      select: [
        "address",
        "fee::text",
        "offpegFeeMultiplier::text",
        "initialA::text",
        "futureA::text",
        "initialATime::text",
        "futureATime::text",
        "isPaused",
        "isDisabled",
        "poolContainsRebasingTokens",
        `coins:${StablePoolTable}-coins(key,value)`,
        `tokenBalances:${StablePoolTable}-tokenBalances(key,value::text)`,
        `adminBalances:${StablePoolTable}-adminBalances(key,value::text)`,
        `rateMultipliers:${StablePoolTable}-rateMultipliers(key,value::text)`,
        `rateOracles:${StablePoolTable}-rateOracles(key,value)`,
        `assetTypes:${StablePoolTable}-assetTypes(key,value::text)`,
      ].join(","),
    },
  });

  const raw = (data as RawStablePoolQuoteRow[])[0];
  if (!raw) throw new Error(`StablePool not found: ${poolAddress}`);
  if (raw.isPaused || raw.isDisabled) throw new Error("Pool is not active");
  // rebasing pools price off live ERC20 balances and vault coins (assetType 3)
  // off a vault exchangeRate call — neither is indexed, so no exact quote
  if (raw.poolContainsRebasingTokens) throw new Error("Quotes are not supported for rebasing pools");
  if ((raw.assetTypes ?? []).some((t) => t.value === "3")) throw new Error("Quotes are not supported for pools with vault coins");

  const coins = [...(raw.coins ?? [])].sort((a, b) => a.key - b.key).map((c) => c.value);
  const i = coins.indexOf(normalizeAddress(tokenIn));
  const j = coins.indexOf(normalizeAddress(tokenOut));
  if (i === -1) throw new Error(`Token ${tokenIn} not found in pool coins`);
  if (j === -1) throw new Error(`Token ${tokenOut} not found in pool coins`);
  if (i === j) throw new Error("Cannot exchange a coin with itself");

  const byCoin = (rows: { key: string; value: string }[]) =>
    new Map((rows ?? []).map((r) => [r.key, r.value]));
  const balanceOf = byCoin(raw.tokenBalances);
  const adminOf = byCoin(raw.adminBalances);
  const multiplierOf = byCoin(raw.rateMultipliers);
  const oracleOf = byCoin(raw.rateOracles);

  // _storedRates: rateMultiplier x oracle price / 1e18, per coin's own oracle
  const oracleAddresses = [...new Set([...oracleOf.values()].filter((a) => a && a !== ZERO_ADDRESS))];
  const priceByOracleAndCoin = new Map<string, bigint>();
  if (oracleAddresses.length > 0) {
    const { data: priceRows } = await cirrus.get(accessToken, `/${constants.PriceOracle}-prices`, {
      params: {
        address: `in.(${oracleAddresses.join(",")})`,
        key: `in.(${coins.join(",")})`,
        select: "address,key,value::text",
      },
    });
    for (const row of priceRows as { address: string; key: string; value: string }[]) {
      priceByOracleAndCoin.set(`${row.address}:${row.key}`, BigInt(row.value));
    }
  }

  const rates = coins.map((coin) => {
    const oracle = oracleOf.get(coin);
    let oraclePrice = stable.PRECISION;
    if (oracle && oracle !== ZERO_ADDRESS) {
      const price = priceByOracleAndCoin.get(`${oracle}:${coin}`) ?? 0n;
      // getAssetPrice reverts on a missing price, and so would the swap
      if (price === 0n) throw new Error(`Price not available for token ${coin}`);
      oraclePrice = price;
    }
    return (BigInt(multiplierOf.get(coin) ?? "0") * oraclePrice) / stable.PRECISION;
  });

  const balances = coins.map((coin) => BigInt(balanceOf.get(coin) ?? "0") - BigInt(adminOf.get(coin) ?? "0"));
  const state: stable.StablePoolState = {
    xp: stable.xpMem(rates, balances),
    rates,
    amp: stable.getA(
      BigInt(raw.initialA),
      BigInt(raw.futureA),
      BigInt(raw.initialATime),
      BigInt(raw.futureATime),
      BigInt(Math.floor(Date.now() / 1000))
    ),
    fee: BigInt(raw.fee),
    offpegFeeMultiplier: BigInt(raw.offpegFeeMultiplier),
  };
  if (state.xp.some((x) => x <= 0n)) throw new Error("Pool has no liquidity");

  const exactOut = amountSpecified < 0n;
  let amountIn: bigint;
  let result: stable.ExchangeResult;
  if (exactOut) {
    const found = stable.simulateExchangeExactOut(state, i, j, -amountSpecified);
    amountIn = found.dx;
    result = found;
  } else {
    amountIn = amountSpecified;
    result = stable.simulateExchange(state, i, j, amountIn);
  }
  if (result.dy <= 0n) throw new Error("Pool has insufficient liquidity for this trade");

  // price impact: fee-less spot rate vs realized execution rate
  const spotWad = stable.spotRate(state, i, j);
  const execWad = (result.dy * 10n ** 18n) / amountIn;
  const spot = Number(spotWad) / 1e18;
  const exec = Number(execWad) / 1e18;
  const priceImpact = spot > 0 ? Math.abs((exec - spot) / spot) * 100 : 0;

  return {
    poolAddress: raw.address,
    tokenIn: coins[i],
    tokenOut: coins[j],
    exactOut,
    amountIn: amountIn.toString(),
    amountOut: result.dy.toString(),
    feeAmount: result.dyFee.toString(),
    fee: Number(BigInt(raw.fee)) / 1e6,
    priceImpact,
    spotRateWad: spotWad.toString(),
  };
};

// ============================================================================
// WRITE OPERATIONS
// ============================================================================

export const createPool = async (
  accessToken: string,
  body: CreatePoolParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { isStable, ...restBody } = body;
  const tx = await buildFunctionTx({
    contractName: extractContractName(PoolFactory),
    contractAddress: constants.poolFactory,
    method: isStable ? "createStablePool" : "createPool",
    args: restBody,
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

// --- Liquidity Operations ---

export const addLiquidityDualToken = async (
  accessToken: string,
  params: LiquidityParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, tokenBAmount, maxTokenAAmount, deadline } = params;

  const pool = await fetchPoolTokenAddresses(accessToken, poolAddress);

  // Execute liquidity deposit
  const tx = await buildFunctionTx([
    buildTokenApprovalTx(pool.tokenA, poolAddress, maxTokenAAmount),
    buildTokenApprovalTx(pool.tokenB, poolAddress, tokenBAmount),
    {
      contractName: extractContractName(PoolTable),
      contractAddress: poolAddress,
      method: "addLiquidity",
      args: { tokenBAmount, maxTokenAAmount, deadline }
    }
  ], userAddress, accessToken);

  const depositResult = await executeTransaction(accessToken, tx);

  return depositResult;
};

export const addLiquiditySingleToken = async (
  accessToken: string,
  params: SingleTokenLiquidityParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, singleTokenAmount, isAToB, deadline } = params;

  const pool = await fetchPoolTokenAddresses(accessToken, poolAddress);
  const depositTokenAddress = isAToB ? pool.tokenA : pool.tokenB;

  // Execute liquidity deposit
  const tx = await buildFunctionTx([
    buildTokenApprovalTx(depositTokenAddress, poolAddress, singleTokenAmount),
    {
      contractName: extractContractName(PoolTable),
      contractAddress: poolAddress,
      method: "addLiquiditySingleToken",
      args: { isAToB, amountIn: singleTokenAmount, deadline }
    }
  ], userAddress, accessToken);

  const depositResult = await executeTransaction(accessToken, tx);

  return depositResult;
};

export const removeLiquidity = async (
  accessToken: string,
  removeLiquidityParams: RemoveLiquidityParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, lpTokenAmount, deadline } = removeLiquidityParams;

  const pool = await fetchPoolBalances(accessToken, poolAddress);

  // Calculate tokenA and tokenB amounts
  const tokenABalance = BigInt(pool.tokenABalance);
  const tokenBBalance = BigInt(pool.tokenBBalance);
  const lpTokenSupply = BigInt(pool.lpToken._totalSupply);
  const lpTokenAmountBigInt = BigInt(lpTokenAmount);

  const tokenAAmount = (tokenABalance * lpTokenAmountBigInt) / lpTokenSupply;
  const tokenBAmount = (tokenBBalance * lpTokenAmountBigInt) / lpTokenSupply;

  // Apply 1% slippage tolerance (99 basis points)
  const minTokenAAmount = (tokenAAmount * 99n) / 100n;
  const minTokenBAmount = (tokenBAmount * 99n) / 100n;

  const txArray: any[] = [];

  // Add removeLiquidity transaction
  txArray.push({
    contractName: extractContractName(PoolTable),
    contractAddress: poolAddress,
    method: "removeLiquidity",
    args: {
      lpTokenAmount,
      minTokenBAmount: minTokenBAmount.toString(),
      minTokenAAmount: minTokenAAmount.toString(),
      deadline
    },
  });

  const tx = await buildFunctionTx(txArray, userAddress, accessToken);
  return executeTransaction(accessToken, tx);
};

// --- Swap Operations ---

export const swap = async (
  accessToken: string,
  swapParams: SwapParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, isAToB, amountIn, minAmountOut, deadline } = swapParams;

  const pool = await fetchPoolTokenAddresses(accessToken, poolAddress);

  const tokenAddress = isAToB ? pool.tokenA : pool.tokenB;

  const tx = await buildFunctionTx([
    buildTokenApprovalTx(tokenAddress, poolAddress, amountIn),
    {
      contractName: extractContractName(PoolTable),
      contractAddress: poolAddress,
      method: "swap",
      args: {
        isAToB,
        amountIn,
        minAmountOut,
        deadline,
      },
    }
  ], userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

// --- Multi-Token Operations ---

export const exchangeMultiToken = async (
  accessToken: string,
  params: MultiTokenSwapParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, tokenIn, tokenOut, amountIn, minAmountOut, deadline } = params;

  // Resolve coin indices
  const coinEntries = await fetchPoolCoins(accessToken, poolAddress);
  const i = resolveCoinIndex(coinEntries, tokenIn);
  const j = resolveCoinIndex(coinEntries, tokenOut);

  const tx = await buildFunctionTx([
    buildTokenApprovalTx(tokenIn, poolAddress, amountIn),
    {
      contractName: extractContractName(StablePoolTable),
      contractAddress: poolAddress,
      method: "exchange",
      args: {
        i,
        j,
        _dx: amountIn,
        _minDy: minAmountOut,
        _receiver: userAddress,
      },
    }
  ], userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

export const addLiquidityMultiToken = async (
  accessToken: string,
  params: MultiTokenLiquidityParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, amounts, minMintAmount, deadline } = params;

  const coinEntries = await fetchPoolCoins(accessToken, poolAddress);

  // Build approval transactions for each coin being deposited
  const approvalTxs = coinEntries
    .filter((_, idx) => amounts[idx] && amounts[idx] !== "0" && BigInt(amounts[idx]) > 0n)
    .map(coin => buildTokenApprovalTx(coin.tokenAddress, poolAddress, amounts[coin.coinIndex]));

  const tx = await buildFunctionTx([
    ...approvalTxs,
    {
      contractName: extractContractName(StablePoolTable),
      contractAddress: poolAddress,
      method: "addLiquidityGeneral",
      args: {
        _amounts: amounts,
        _minMintAmount: minMintAmount,
        _receiver: userAddress,
      },
    }
  ], userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

export const removeLiquidityMultiToken = async (
  accessToken: string,
  params: MultiTokenRemoveLiquidityParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, lpTokenAmount, minAmounts, deadline } = params;

  const tx = await buildFunctionTx({
    contractName: extractContractName(StablePoolTable),
    contractAddress: poolAddress,
    method: "removeLiquidityGeneral",
    args: {
      _burnAmount: lpTokenAmount,
      _minAmounts: minAmounts,
      _receiver: userAddress,
      _claimAdminFees: true,
    },
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

export const removeLiquidityMultiTokenOneCoin = async (
  accessToken: string,
  params: MultiTokenRemoveLiquidityOneParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, lpTokenAmount, coinIndex, minReceived, deadline } = params;

  const tx = await buildFunctionTx({
    contractName: extractContractName(StablePoolTable),
    contractAddress: poolAddress,
    method: "removeliquidityOneCoin",
    args: {
      _burnAmount: lpTokenAmount,
      i: coinIndex,
      _minReceived: minReceived,
      _receiver: userAddress,
    },
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

// --- Admin Operations ---

export const setPoolRates = async (
  accessToken: string,
  setPoolRatesParams: SetPoolRatesParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, swapFeeRate, lpSharePercent } = setPoolRatesParams;

  // Call setPoolFeeParameters on PoolFactory instead of calling Pool directly
  const tx = await buildFunctionTx({
    contractName: extractContractName(PoolFactory),
    contractAddress: config.poolFactory,
    method: "setPoolFeeParameters",
    args: {
      poolAddress: poolAddress,
      newSwapFeeRate: swapFeeRate.toString(),
      newLpSharePercent: lpSharePercent.toString(),
    },
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

export const pausePool = async (
  accessToken: string,
  poolAddress: string,
  userAddress: string
): Promise<TransactionResponse> => {
  const tx = await buildFunctionTx({
    contractName: extractContractName(PoolTable),
    contractAddress: poolAddress,
    method: "setPaused",
    args: {
      _isPaused: true,
    },
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

export const unpausePool = async (
  accessToken: string,
  poolAddress: string,
  userAddress: string
): Promise<TransactionResponse> => {
  const tx = await buildFunctionTx({
    contractName: extractContractName(PoolTable),
    contractAddress: poolAddress,
    method: "setPaused",
    args: {
      _isPaused: false,
    },
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

export const disablePool = async (
  accessToken: string,
  poolAddress: string,
  userAddress: string
): Promise<TransactionResponse> => {
  const tx = await buildFunctionTx({
    contractName: extractContractName(PoolTable),
    contractAddress: poolAddress,
    method: "setDisabled",
    args: {
      _isDisabled: true,
    },
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

export const enablePool = async (
  accessToken: string,
  poolAddress: string,
  userAddress: string
): Promise<TransactionResponse> => {
  const tx = await buildFunctionTx({
    contractName: extractContractName(PoolTable),
    contractAddress: poolAddress,
    method: "setDisabled",
    args: {
      _isDisabled: false,
    },
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

