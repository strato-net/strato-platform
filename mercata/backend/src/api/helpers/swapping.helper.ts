import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { SwapToken, LPToken, PoolCoin, RawGetPool, RawPoolFactory, RawToken, RawLPToken, RawSwapEvent, RawPoolCoin, RawPoolTokenBalance, OraclePriceMap } from "@mercata/shared-types";
import { safeBigInt, safeBigIntDivide } from "../../utils/bigIntUtils";
import { toUTCTime } from "./cirrusHelpers";
import { getOraclePrices } from "../services/oracle.service";
import JSONBig from "json-bigint";

const { Pool, PoolSwap, StablePoolCoins, StablePoolTokenBalances, swapHistorySelectFields, swapTokenSelectFields, LendingRegistry } = constants;
const WAD = 10n ** 18n;
const JSONbigString = JSONBig({ storeAsString: true });

// ============================================================================
// CALCULATION HELPERS
// ============================================================================

export const calculateImpliedPrice = (
  amountIn: string,
  amountOut: string,
  isAToB: boolean,
  isStable: boolean
): string => {
  const inBig = safeBigInt(amountIn);
  const outBig = safeBigInt(amountOut);

  if (inBig === 0n || outBig === 0n) return '0.00';

  const one = 10n**18n;
  let numerator = isAToB ? outBig * one : inBig * one;
  numerator = isStable ? (isAToB ? 1000n * numerator / 997n : 997n * numerator / 1000n): numerator;

  // Always calculate as TokenB/TokenA
  const price = isAToB
    ? safeBigIntDivide(numerator, inBig, "A to B price calculation")  // A→B: out/in
    : safeBigIntDivide(numerator, outBig, "B to A price calculation"); // B→A: in/out

  return (Number(price) / 1e18).toFixed(6);
};

/**
 * Calculate pool APY based on actual fees earned over 24h
 * @param fees24h 24-hour fees earned by LPs in USD
 * @param totalLiquidity Total value locked in the pool in USD
 * @returns APY as a percentage
 */
export const calculatePoolAPY = (
  fees24h: string,
  totalLiquidity: string
): number => {
  const fees = parseFloat(fees24h);
  const liquidity = parseFloat(totalLiquidity);

  if (!fees || !liquidity) return 0;

  return Math.max(0, (fees / liquidity) * 365 * 100);
};

/**
 * Calculate fees earned by LPs from trading volume
 * @param tradingVolume24h 24-hour trading volume in USD
 * @param swapFeeRate Swap fee rate in basis points (e.g., 30 = 0.3%)
 * @param lpSharePercent LP share percentage in basis points (e.g., 7000 = 70%)
 * @returns Fees earned by LPs in USD
 */
export const calculateLPFees24h = (
  tradingVolume24h: string,
  swapFeeRate: number,
  lpSharePercent: number
): string => {
  const volume = parseFloat(tradingVolume24h);
  if (!volume) return "0";

  const totalFees = volume * (swapFeeRate / 10000);
  const lpFees = totalFees * (lpSharePercent / 10000);

  return lpFees.toString();
};

/**
 * Calculate LP token price based on underlying token values
 * @param tokenABalance Balance of token A in the pool
 * @param tokenBBalance Balance of token B in the pool
 * @param tokenAPrice Price of token A in USD
 * @param tokenBPrice Price of token B in USD
 * @param lpTokenTotalSupply Total supply of LP tokens
 * @returns LP token price in USD
 */
export const calculateLPTokenPrice = (
  tokenABalance: string,
  tokenBBalance: string,
  tokenAPrice: string,
  tokenBPrice: string,
  lpTokenTotalSupply: string
): string => {
  const aBal = safeBigInt(tokenABalance);
  const bBal = safeBigInt(tokenBBalance);
  const aPrice = safeBigInt(tokenAPrice);
  const bPrice = safeBigInt(tokenBPrice);
  const supply = safeBigInt(lpTokenTotalSupply);

  if (supply === 0n) return "0";
  if ((aBal === 0n && bBal === 0n) || (aPrice === 0n && bPrice === 0n)) return "0";

  const Q = 10n ** 18n;
  const totalValueUSD = safeBigIntDivide(aBal * aPrice + bBal * bPrice, Q, "Total value USD calculation"); // both prices are 1e18-scaled

  return safeBigIntDivide(totalValueUSD * Q, supply, "LP token price calculation").toString();
};

// ============================================================================
// DATA PROCESSING HELPERS
// ============================================================================

export const buildPoolParams = (rawParams: Record<string, string | undefined>, userAddress?: string): Record<string, string> => ({
  poolFactory: "eq." + constants.poolFactory,
  ...Object.fromEntries(Object.entries(rawParams).filter(([_, v]) => v !== undefined)),
  select: rawParams.select || constants.swapSelectFields.join(","),
  ...(rawParams.select || !userAddress ? {} : {
    "lpToken.balances.value": "gt.0",
    "lpToken.balances.key": `eq.${userAddress}`,
    "tokenA.balances.value": "gt.0",
    "tokenA.balances.key": `eq.${userAddress}`,
    "tokenB.balances.value": "gt.0",
    "tokenB.balances.key": `eq.${userAddress}`,
  }),
});

export const extractTokenAddresses = <T extends { tokenA: { address: string }; tokenB: { address: string } }>(poolData: T[]): string[] => [
  ...new Set([
    ...poolData.map(p => p.tokenA.address),
    ...poolData.map(p => p.tokenB.address)
  ])
];

export const extractTokenAddressesFromTokens = (tokens: { address: string }[]): string[] => [
  ...new Set(tokens.map(token => token.address))
];

/**
 * Gets token balance for a specific user address
 */
export const getTokenBalance = (token: RawToken, userAddress: string): string => {
  const balance = token.balances.find(b => b.user === userAddress);
  return balance?.balance ?? "0";
};

export const getTradingVolume24hForPools = async (
  accessToken: string,
  poolAddresses: string[],
  priceMap: OraclePriceMap
): Promise<Map<string, string>> => {
  if (poolAddresses.length === 0) {
    return new Map();
  }

  const { data: swapEvents } = await cirrus.get(accessToken, `/${PoolSwap}`, {
    params: {
      address: `in.(${poolAddresses.join(',')})`,
      "pool.poolFactory": `eq.${constants.poolFactory}`,
      select: swapHistorySelectFields.join(','),
      block_timestamp: `gte.${toUTCTime(new Date(Date.now() - 24 * 60 * 60 * 1000))}`,
    }
  });

  if (!Array.isArray(swapEvents)) {
    return new Map();
  }

  const volumeMap = new Map<string, string>();

  (swapEvents as RawSwapEvent[]).forEach(event => {
    const poolAddress = event.address;
    const currentVolume = volumeMap.get(poolAddress) || "0";

    const tokenInAddress = event.tokenIn;
    const tokenInPrice = priceMap.get(tokenInAddress) || "0";

    const tokenInVolume = safeBigIntDivide(
      safeBigInt(event.amountIn) * safeBigInt(tokenInPrice),
      safeBigInt(10 ** 18),
      "Volume calculation"
    );

    const newVolume = safeBigInt(currentVolume) + tokenInVolume;
    volumeMap.set(poolAddress, newVolume.toString());
  });

  return volumeMap;
};

type LiquidityFlowTotals = {
  totalDepositedUsd: bigint;
  totalWithdrawnUsd: bigint;
};

const normalizeAddress = (value: unknown): string =>
  String(value || "").toLowerCase().replace(/^0x/, "");

const parseAttributes = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") {
    try {
      return JSONbigString.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (value as Record<string, unknown> | undefined) || {};
};

const toIntegerString = (value: unknown): string => {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "0";
    // Avoid scientific notation and preserve integer representation for large numbers.
    return value.toLocaleString("fullwide", { useGrouping: false });
  }

  const raw = String(value ?? "0").trim();
  if (/^-?\d+$/.test(raw)) return raw;

  // Handle scientific notation (e.g. "1e+22") emitted by generic JSON parsing.
  const sci = raw.match(/^(-?)(\d+)(?:\.(\d+))?[eE]\+?(\d+)$/);
  if (!sci) return "0";

  const [, sign, intPart, fracPart = "", expPart] = sci;
  const exponent = Number(expPart);
  if (!Number.isFinite(exponent)) return "0";
  const digits = intPart + fracPart;
  const shift = exponent - fracPart.length;
  if (shift < 0) return "0";

  return `${sign}${digits}${"0".repeat(shift)}`;
};

const normalizeArrayLike = (value: unknown): string[] => {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSONbigString.parse(parsed);
    } catch {
      return [];
    }
  }

  if (Array.isArray(parsed)) return parsed.map((item) => String(item));
  if (!parsed || typeof parsed !== "object") return [];

  return Object.keys(parsed as Record<string, unknown>)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => String((parsed as Record<string, unknown>)[key]));
};

const extractEventActor = (event: { attributes?: unknown; transaction_sender?: unknown }): string => {
  const attrs = parseAttributes(event.attributes);

  return normalizeAddress(
    attrs.provider || attrs.user || attrs.sender || event.transaction_sender || ""
  );
};

const extractLiquidityTokenAmounts = (attributes: unknown): { tokenAAmount: bigint; tokenBAmount: bigint } => {
  const attrs = parseAttributes(attributes);

  // Regular Pool events
  let tokenAAmount = safeBigInt(toIntegerString(attrs.tokenAAmount || "0"));
  let tokenBAmount = safeBigInt(toIntegerString(attrs.tokenBAmount || "0"));

  // StablePool events use tokenAmounts[]; map first 2 entries to pool tokenA/tokenB.
  if (tokenAAmount === 0n && tokenBAmount === 0n) {
    const tokenAmounts = normalizeArrayLike(attrs.tokenAmounts);
    if (tokenAmounts.length >= 2) {
      tokenAAmount = safeBigInt(toIntegerString(tokenAmounts[0]));
      tokenBAmount = safeBigInt(toIntegerString(tokenAmounts[1]));
    }
  }

  return { tokenAAmount, tokenBAmount };
};

/**
 * Compute user-level liquidity flow totals for each pool:
 * netInvestedUsd = totalDepositedUsd - totalWithdrawnUsd
 */
export const getUserPoolLiquidityFlowTotals = async (
  accessToken: string,
  pools: RawGetPool[],
  userAddress: string,
  currentPriceMap: OraclePriceMap
): Promise<Map<string, LiquidityFlowTotals>> => {
  const totals = new Map<string, LiquidityFlowTotals>();
  if (!userAddress || pools.length === 0) return totals;
  const normalizedUserAddress = normalizeAddress(userAddress);

  const poolByAddress = new Map<string, RawGetPool>();
  for (const pool of pools) {
    const key = pool.address.toLowerCase();
    poolByAddress.set(key, pool);
    totals.set(key, { totalDepositedUsd: 0n, totalWithdrawnUsd: 0n });
  }

  const poolAddresses = pools.map((pool) => pool.address);

  const { data: lendingRegistryData } = await cirrus.get(accessToken, `/${LendingRegistry}`, {
    params: {
      address: `eq.${constants.lendingRegistry}`,
      select: "priceOracle",
      limit: "1",
    },
  });
  const oracleAddress = lendingRegistryData?.[0]?.priceOracle;
  if (!oracleAddress) return totals;

  const { data: events } = await cirrus.get(accessToken, "/event", {
    params: {
      address: `in.(${poolAddresses.join(",")})`,
      event_name: "in.(AddLiquidity,RemoveLiquidity)",
      select: "address,event_name,attributes,block_timestamp,transaction_sender",
      order: "block_timestamp.asc",
      limit: "10000",
    },
  });

  if (!Array.isArray(events) || events.length === 0) return totals;

  const historicalPriceCache = new Map<string, bigint>();
  const getHistoricalPrice = async (tokenAddress: string, timestamp: string): Promise<bigint> => {
    const cacheKey = `${tokenAddress.toLowerCase()}|${timestamp}`;
    const cached = historicalPriceCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const { data } = await cirrus.get(accessToken, "/history@mapping", {
      params: {
        select: "value::text",
        address: `eq.${oracleAddress}`,
        collection_name: "eq.prices",
        "key->>key": `eq.${tokenAddress}`,
        valid_from: `lte.${timestamp}`,
        valid_to: `gte.${timestamp}`,
        order: "valid_from.desc",
        limit: "1",
      },
    });

    const historical = safeBigInt(data?.[0]?.value || "0");
    const fallback = safeBigInt(currentPriceMap.get(tokenAddress) || "0");
    const resolved = historical > 0n ? historical : fallback;
    historicalPriceCache.set(cacheKey, resolved);
    return resolved;
  };

  for (const event of events) {
    const actor = extractEventActor(event);
    if (actor !== normalizedUserAddress) continue;

    const poolAddress = (event.address || "").toLowerCase();
    const pool = poolByAddress.get(poolAddress);
    if (!pool) continue;

    const { tokenAAmount, tokenBAmount } = extractLiquidityTokenAmounts(event.attributes);
    if (tokenAAmount === 0n && tokenBAmount === 0n) continue;

    const [tokenAPrice, tokenBPrice] = await Promise.all([
      getHistoricalPrice(pool.tokenA.address, event.block_timestamp),
      getHistoricalPrice(pool.tokenB.address, event.block_timestamp),
    ]);

    const usdValue = ((tokenAAmount * tokenAPrice) + (tokenBAmount * tokenBPrice)) / WAD;
    const current = totals.get(poolAddress) || { totalDepositedUsd: 0n, totalWithdrawnUsd: 0n };

    if (event.event_name === "AddLiquidity") {
      current.totalDepositedUsd += usdValue;
    } else if (event.event_name === "RemoveLiquidity") {
      current.totalWithdrawnUsd += usdValue;
    }
    totals.set(poolAddress, current);
  }

  return totals;
};

export const calculatePoolMetrics = (
  pool: RawGetPool,
  tokenAPrice: string,
  tokenBPrice: string,
  volume24h: string,
  factoryData?: RawPoolFactory
): {
  totalLiquidityUSD: string;
  apy: number;
  lpTokenPrice: string;
  swapFeeRate: number;
  lpSharePercent: number;
} => {
  const tokenAValue = safeBigIntDivide(
    safeBigInt(pool.tokenABalance) * safeBigInt(tokenAPrice),
    safeBigInt(10 ** 18),
    "Token A value calculation"
  );
  const tokenBValue = safeBigIntDivide(
    safeBigInt(pool.tokenBBalance) * safeBigInt(tokenBPrice),
    safeBigInt(10 ** 18),
    "Token B value calculation"
  );
  const totalLiquidityUSD = (tokenAValue + tokenBValue).toString();

  const swapFeeRate = pool.swapFeeRate || factoryData?.swapFeeRate || 30;
  const lpSharePercent = pool.lpSharePercent || factoryData?.lpSharePercent || 7000;

  const fees24h = calculateLPFees24h(volume24h, swapFeeRate, lpSharePercent);
  const apy = calculatePoolAPY(fees24h, totalLiquidityUSD);

  const lpTokenPrice = calculateLPTokenPrice(
    pool.tokenABalance,
    pool.tokenBBalance,
    tokenAPrice,
    tokenBPrice,
    pool.lpToken._totalSupply
  );

  return { totalLiquidityUSD, apy, lpTokenPrice, swapFeeRate, lpSharePercent };
};

export const calculateOracleRatios = (tokenAPrice: string, tokenBPrice: string): { aToB: string; bToA: string } => {
  if (tokenAPrice === "0" || tokenBPrice === "0") return { aToB: "0", bToA: "0" };
  return {
    aToB: (Number(tokenAPrice) / Number(tokenBPrice)).toFixed(18),
    bToA: (Number(tokenBPrice) / Number(tokenAPrice)).toFixed(18)
  };
};

// ============================================================================
// BUILDER HELPERS
// ============================================================================

export const buildSwapToken = (
  token: RawToken,
  price: string,
  poolBalance: string,
  userBalance: string
): SwapToken => ({
  address: token.address,
  _name: token._name,
  _symbol: token._symbol,
  customDecimals: token.customDecimals,
  _totalSupply: token._totalSupply,
  balance: userBalance,
  price,
  poolBalance,
  images: token.images.filter(img => img.value && img.value.trim() !== "")
});

export const buildLPToken = (
  lpToken: RawLPToken,
  price: string,
  userBalance: string
): LPToken => {
  return {
    address: lpToken.address,
    _name: lpToken._name,
    _symbol: lpToken._symbol,
    customDecimals: lpToken.customDecimals,
    _totalSupply: lpToken._totalSupply,
    balance: userBalance,
    price,
    images: lpToken.images.filter(img => img.value && img.value.trim() !== ""),
    totalBalance: userBalance
  };
};

export const buildPoolList = (
  pools: RawGetPool[],
  priceMap: OraclePriceMap,
  volumeMap: Map<string, string>,
  factoryData: RawPoolFactory | undefined,
  userAddress: string | undefined
) => {
  return pools.map((pool: RawGetPool) => {
    const tokenAPrice = priceMap.get(pool.tokenA.address) || "0";
    const tokenBPrice = priceMap.get(pool.tokenB.address) || "0";
    const volume24h = volumeMap.get(pool.address) || "0";

    const { totalLiquidityUSD, apy, lpTokenPrice, swapFeeRate, lpSharePercent } =
      calculatePoolMetrics(pool, tokenAPrice, tokenBPrice, volume24h, factoryData);

    const { aToB: oracleAToBRatio, bToA: oracleBToARatio } =
      calculateOracleRatios(tokenAPrice, tokenBPrice);

    const tokenABalance = getTokenBalance(pool.tokenA, userAddress || "");
    const tokenBBalance = getTokenBalance(pool.tokenB, userAddress || "");
    const lpTokenBalance = getTokenBalance(pool.lpToken, userAddress || "");

    const symbolA = pool.tokenA._symbol;
    const symbolB = pool.tokenB._symbol;

    const poolFlags = pool as RawGetPool & { isPaused?: boolean; isDisabled?: boolean };

    return {
      address: pool.address,
      poolName: `${symbolA}-${symbolB}`,
      poolSymbol: `${symbolA}-${symbolB}`,
      tokenA: buildSwapToken(pool.tokenA, tokenAPrice, pool.tokenABalance, tokenABalance),
      tokenB: buildSwapToken(pool.tokenB, tokenBPrice, pool.tokenBBalance, tokenBBalance),
      lpToken: buildLPToken(pool.lpToken, lpTokenPrice, lpTokenBalance),
      totalLiquidityUSD,
      tradingVolume24h: volume24h,
      apy: apy.toFixed(2),
      aToBRatio: pool.aToBRatio,
      bToARatio: pool.bToARatio,
      oracleAToBRatio,
      oracleBToARatio,
      swapFeeRate,
      lpSharePercent,
      isStable: pool.isStable,
      isPaused: poolFlags.isPaused ?? false,
      isDisabled: poolFlags.isDisabled ?? false,
    };
  });
};

// ============================================================================
// API HELPERS
// ============================================================================

/**
 * Fetches pool token addresses for a given pool
 */
export const fetchPoolTokenAddresses = async (accessToken: string, poolAddress: string): Promise<{ tokenA: string; tokenB: string }> => {
  const { data: poolData } = await cirrus.get(accessToken, `/${Pool}`, {
    params: {
      poolFactory: "eq." + constants.poolFactory,
      address: "eq." + poolAddress,
      select: "tokenA,tokenB"
    }
  });

  return poolData[0];
};

/**
 * Fetches pool balances and LP token supply for removeLiquidity operations
 */
export const fetchPoolBalances = async (accessToken: string, poolAddress: string) => {
  const { data: poolData } = await cirrus.get(accessToken, `/${Pool}`, {
    params: {
      poolFactory: "eq." + constants.poolFactory,
      address: "eq." + poolAddress,
      select: "tokenABalance::text,tokenBBalance::text,lpToken:lpToken_fkey(_totalSupply::text)"
    }
  });

  return poolData[0];
};

/**
 * Fetches the LP token address for a given pool
 */
export const fetchLPTokenAddress = async (
  accessToken: string,
  poolAddress: string
): Promise<string> => {
  const { data: poolData } = await cirrus.get(accessToken, `/${Pool}`, {
    params: {
      poolFactory: "eq." + constants.poolFactory,
      address: "eq." + poolAddress,
      select: "lpToken"
    }
  });
  const lpTokenAddress = poolData?.[0]?.lpToken;

  if (!lpTokenAddress) {
    throw new Error("Could not fetch LP token address for pool");
  }

  return lpTokenAddress;
};

// ============================================================================
// TRANSACTION HELPERS
// ============================================================================

/**
 * Builds a token approval transaction
 */
export const buildTokenApprovalTx = (tokenAddress: string, spender: string, amount: string) => ({
  contractName: "Token",
  contractAddress: tokenAddress,
  method: "approve",
  args: { spender, value: amount }
});

// ============================================================================
// MULTI-TOKEN POOL HELPERS
// ============================================================================

/**
 * Fetches the coin addresses for a multi-token StablePool
 * Returns an array of { coinIndex, tokenAddress } sorted by coin index
 */
export const fetchPoolCoins = async (
  accessToken: string,
  poolAddress: string
): Promise<{ coinIndex: number; tokenAddress: string }[]> => {
  const { data: coins } = await cirrus.get(accessToken, `/${StablePoolCoins}`, {
    params: {
      address: `eq.${poolAddress}`,
      select: "key,value",
      order: "key.asc"
    }
  });

  return (coins as RawPoolCoin[]).map(c => ({
    coinIndex: Number(c.key),
    tokenAddress: c.value
  }));
};

/**
 * Fetches the pool balances for all coins in a multi-token StablePool
 * Returns a map of tokenAddress -> balance
 */
export const fetchPoolTokenBalances = async (
  accessToken: string,
  poolAddress: string
): Promise<Map<string, string>> => {
  const { data: balances } = await cirrus.get(accessToken, `/${StablePoolTokenBalances}`, {
    params: {
      address: `eq.${poolAddress}`,
      select: "key,value::text"
    }
  });

  const balanceMap = new Map<string, string>();
  (balances as RawPoolTokenBalance[]).forEach(b => {
    balanceMap.set(b.key, b.value);
  });
  return balanceMap;
};

/**
 * Fetches token metadata for a list of token addresses
 */
export const fetchTokenMetadata = async (
  accessToken: string,
  tokenAddresses: string[],
  userAddress?: string
): Promise<Map<string, RawToken>> => {
  const { data: tokens } = await cirrus.get(accessToken, `/${constants.Token}`, {
    params: {
      address: `in.(${tokenAddresses.join(",")})`,
      select: swapTokenSelectFields.join(","),
      ...(userAddress ? { "balances.key": `eq.${userAddress}` } : {}),
    }
  });

  const tokenMap = new Map<string, RawToken>();
  (tokens as RawToken[]).forEach(t => {
    tokenMap.set(t.address, t);
  });
  return tokenMap;
};

/**
 * Builds PoolCoin array for a multi-token pool
 */
export const buildPoolCoins = (
  coinEntries: { coinIndex: number; tokenAddress: string }[],
  tokenMetadataMap: Map<string, RawToken>,
  poolBalanceMap: Map<string, string>,
  priceMap: OraclePriceMap,
  userAddress?: string
): PoolCoin[] => {
  return coinEntries.map(({ coinIndex, tokenAddress }) => {
    const token = tokenMetadataMap.get(tokenAddress);
    const poolBalance = poolBalanceMap.get(tokenAddress) || "0";
    const price = priceMap.get(tokenAddress) || "0";
    const userBalance = token && userAddress
      ? getTokenBalance(token, userAddress)
      : "0";

    return {
      coinIndex,
      address: tokenAddress,
      _name: token?._name || "",
      _symbol: token?._symbol || "",
      customDecimals: token?.customDecimals || 18,
      _totalSupply: token?._totalSupply || "0",
      balance: userBalance,
      price,
      poolBalance,
      images: token?.images?.filter(img => img.value && img.value.trim() !== "") || [],
    };
  });
};

/**
 * Calculate LP token price for a multi-token pool using all coin balances
 */
export const calculateMultiTokenLPPrice = (
  coins: PoolCoin[],
  lpTokenTotalSupply: string
): string => {
  const supply = safeBigInt(lpTokenTotalSupply);
  if (supply === 0n) return "0";

  const Q = 10n ** 18n;
  let totalValueUSD = 0n;

  for (const coin of coins) {
    const bal = safeBigInt(coin.poolBalance);
    const price = safeBigInt(coin.price);
    if (bal > 0n && price > 0n) {
      totalValueUSD += safeBigIntDivide(bal * price, Q, `${coin._symbol} value`);
    }
  }

  if (totalValueUSD === 0n) return "0";
  return safeBigIntDivide(totalValueUSD * Q, supply, "Multi-token LP price").toString();
};

/**
 * Calculate total liquidity USD for a multi-token pool
 */
export const calculateMultiTokenLiquidity = (
  coins: PoolCoin[]
): string => {
  const Q = 10n ** 18n;
  let totalValueUSD = 0n;

  for (const coin of coins) {
    const bal = safeBigInt(coin.poolBalance);
    const price = safeBigInt(coin.price);
    if (bal > 0n && price > 0n) {
      totalValueUSD += safeBigIntDivide(bal * price, Q, `${coin._symbol} liquidity`);
    }
  }

  return totalValueUSD.toString();
};

/**
 * Resolves the coin index for a given token address within a multi-token pool
 */
export const resolveCoinIndex = (
  coins: { coinIndex: number; tokenAddress: string }[],
  tokenAddress: string
): number => {
  const coin = coins.find(c => c.tokenAddress.toLowerCase() === tokenAddress.toLowerCase());
  if (coin === undefined) {
    throw new Error(`Token ${tokenAddress} not found in pool coins`);
  }
  return coin.coinIndex;
};

/**
 * Fetches coin addresses for a multi-token pool (for transaction building)
 */
export const fetchPoolCoinAddresses = async (
  accessToken: string,
  poolAddress: string
): Promise<{ coinIndex: number; tokenAddress: string }[]> => {
  return fetchPoolCoins(accessToken, poolAddress);
};

export interface MultiTokenStablePool {
  address: string;
  lpToken: string;
  fee: string;
  coins: { coinIndex: number; tokenAddress: string }[];
  tokenBalances: Map<string, string>;
}

/**
 * Dynamically discovers multi-token stable pools by querying StablePool
 * contracts with initialA > 0 and joining coins + tokenBalances.
 * Returns only pools with > 2 coins.
 */
export const fetchMultiTokenStablePools = async (
  accessToken: string,
): Promise<MultiTokenStablePool[]> => {
  const { data: stablePools } = await cirrus.get(accessToken, "/BlockApps-StablePool", {
    params: {
      initialA: "gt.0",
      select: "address,lpToken,fee::text,BlockApps-StablePool-coins(key,value),BlockApps-StablePool-tokenBalances(key,value::text)",
    }
  });

  const results: MultiTokenStablePool[] = [];
  for (const pool of stablePools as any[]) {
    const rawCoins = pool["BlockApps-StablePool-coins"] || [];
    if (rawCoins.length <= 2) continue;

    const coins = rawCoins.map((c: any) => ({
      coinIndex: Number(c.key),
      tokenAddress: c.value,
    }));

    const tokenBalances = new Map<string, string>();
    for (const b of pool["BlockApps-StablePool-tokenBalances"] || []) {
      tokenBalances.set(b.key, b.value);
    }

    results.push({ address: pool.address, lpToken: pool.lpToken, fee: pool.fee || "0", coins, tokenBalances });
  }

  return results;
};

/**
 * Builds a full Pool object from a multi-token StablePool's on-chain data.
 * Used to include multi-token pools in pool lists even though they don't
 * appear in the BlockApps-Pool table with valid tokenA/tokenB.
 */
export const buildMultiTokenPoolEntry = async (
  accessToken: string,
  stablePool: MultiTokenStablePool,
  priceMap: OraclePriceMap,
  volumeMap: Map<string, string>,
  factoryData: { swapFeeRate: number; lpSharePercent: number },
  userAddress?: string,
): Promise<any> => {
  const coinAddresses = stablePool.coins.map(c => c.tokenAddress);

  const [tokenMetadataMap, lpTokenData] = await Promise.all([
    fetchTokenMetadata(accessToken, coinAddresses, userAddress),
    fetchTokenMetadata(accessToken, [stablePool.lpToken], userAddress),
  ]);

  // Fetch prices for coins not yet in priceMap
  const missingPriceAddresses = coinAddresses.filter(addr => !priceMap.has(addr));
  if (missingPriceAddresses.length > 0) {
    const additionalPrices = await getOraclePrices(accessToken, {
      select: "asset:key,price:value::text",
      key: `in.(${missingPriceAddresses.join(',')})`
    });
    additionalPrices.forEach((price, addr) => priceMap.set(addr, price));
  }

  const coins = buildPoolCoins(stablePool.coins, tokenMetadataMap, stablePool.tokenBalances, priceMap, userAddress);
  const totalLiquidityUSD = calculateMultiTokenLiquidity(coins);
  const volume24h = volumeMap.get(stablePool.address) || "0";

  const swapFeeRate = factoryData.swapFeeRate;
  const lpSharePercent = factoryData.lpSharePercent;
  const fees24h = calculateLPFees24h(volume24h, swapFeeRate, lpSharePercent);
  const apy = calculatePoolAPY(fees24h, totalLiquidityUSD);

  const lpTokenRaw = lpTokenData.get(stablePool.lpToken);
  const lpTotalSupply = lpTokenRaw?._totalSupply || "0";
  const lpPrice = calculateMultiTokenLPPrice(coins, lpTotalSupply);
  const lpBalance = lpTokenRaw && userAddress ? getTokenBalance(lpTokenRaw, userAddress) : "0";

  const symbols = coins.map(c => c._symbol).filter(Boolean);
  const coinA = coins[0];
  const coinB = coins[1];

  return {
    address: stablePool.address,
    poolName: symbols.join("-"),
    poolSymbol: symbols.join("-"),
    tokenA: {
      address: coinA?.address || "",
      _name: coinA?._name || "",
      _symbol: coinA?._symbol || "",
      _totalSupply: coinA?._totalSupply || "0",
      customDecimals: coinA?.customDecimals || 18,
      balance: coinA?.balance || "0",
      poolBalance: coinA?.poolBalance || "0",
      price: coinA?.price || "0",
      images: coinA?.images || [],
    },
    tokenB: {
      address: coinB?.address || "",
      _name: coinB?._name || "",
      _symbol: coinB?._symbol || "",
      _totalSupply: coinB?._totalSupply || "0",
      customDecimals: coinB?.customDecimals || 18,
      balance: coinB?.balance || "0",
      poolBalance: coinB?.poolBalance || "0",
      price: coinB?.price || "0",
      images: coinB?.images || [],
    },
    lpToken: lpTokenRaw
      ? buildLPToken(lpTokenRaw, lpPrice, lpBalance)
      : { address: stablePool.lpToken, _name: "", _symbol: "", _totalSupply: lpTotalSupply, customDecimals: 18, balance: lpBalance, price: lpPrice, images: [], totalBalance: lpBalance },
    totalLiquidityUSD,
    tradingVolume24h: volume24h,
    apy: apy.toFixed(2),
    aToBRatio: "0",
    bToARatio: "0",
    oracleAToBRatio: "0",
    oracleBToARatio: "0",
    swapFeeRate,
    lpSharePercent,
    isStable: true,
    isPaused: false,
    isDisabled: false,
    coins,
  };
};
