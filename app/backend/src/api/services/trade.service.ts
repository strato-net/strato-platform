/**
 * Unified trade service — the thin composition layer over the two domain
 * services: swapping.service (V2 constant-product + stable pools) and
 * poolV3.service (V3 concentrated liquidity). It discovers candidates through
 * them, normalizes everything into the TradePool/TradeQuote shapes, fans out
 * exact quotes, and dispatches execution — but owns no pool-type-specific
 * queries or math itself (those live in the domain services and the
 * poolV2Math/stablePoolMath/poolV3Math helpers).
 */
import { getV2QuoteExactIn, getV2QuoteExactOut } from "../helpers/poolV2Math.helper";
import {
  fetchTokenMetadata,
  fetchPoolTokenAddresses,
  fetchPoolCoins,
  buildSwapToken,
  getTokenBalance,
} from "../helpers/swapping.helper";
import { getOraclePrices } from "./oracle.service";
import {
  swap as executeV2Swap,
  exchangeMultiToken,
  getStableQuote,
  getSwapableTokens,
  getSwapableTokenPairs,
  getPairSwapHistory,
  getPairPoolCandidates,
  PairPoolCandidate,
} from "./swapping.service";
import {
  getPoolsByPair as getV3PoolsByPair,
  getQuote as getV3Quote,
  swap as executeV3Swap,
  getFundedPoolTokenBalances as getV3FundedTokenBalances,
  getPoolTokenPairs as getV3PoolTokenPairs,
} from "./poolV3.service";
import {
  RawToken,
  TradePool,
  TradePoolSide,
  TradeQuote,
  TradeQuoteResponse,
  TradeSwapParams,
  TransactionResponse,
  SwapHistoryResponse,
  SwapToken,
} from "@strato/shared-types";

const WAD = 10n ** 18n;
const ACTIVE_TOKEN_STATUS = "2";
export const TRADE_DEADLINE_SECONDS = 300;

const normalizeAddress = (address: string): string => address.toLowerCase().replace(/^0x/, "");

// ============================================================================
// READ DELEGATES (pair history lives in swapping.service, which merges venues)
// ============================================================================

export const getTradeHistory = (
  accessToken: string,
  tokenA: string,
  tokenB: string,
  page?: number,
  limit?: number,
  sender?: string
): Promise<SwapHistoryResponse> => getPairSwapHistory(accessToken, tokenA, tokenB, page, limit, sender);

// ============================================================================
// TOKEN LISTS
// V2/stable token discovery comes from swapping.service, V3 balances from
// poolV3.service; tokens only tradable on V3 pools are merged in here.
// ============================================================================

/**
 * Merge externally-discovered token balances into a token list: existing
 * entries with an empty pool balance pick it up, unknown tokens are fetched
 * (metadata + oracle price) and added.
 */
const mergeTokenBalances = async (
  accessToken: string,
  tokenMap: Map<string, SwapToken>,
  balances: Map<string, bigint>,
  userAddress: string
): Promise<void> => {
  for (const [addr, balance] of balances) {
    const existing = tokenMap.get(addr);
    if (existing && BigInt(existing.poolBalance || "0") === 0n) {
      tokenMap.set(addr, { ...existing, poolBalance: balance.toString() });
    }
  }

  const missing = [...balances.keys()].filter((addr) => !tokenMap.has(addr));
  if (missing.length === 0) return;

  const [metadata, prices] = await Promise.all([
    fetchTokenMetadata(accessToken, missing, userAddress),
    getOraclePrices(accessToken, {
      select: "asset:key,price:value::text",
      key: `in.(${missing.join(",")})`,
    }),
  ]);

  for (const addr of missing) {
    const raw = metadata.get(addr);
    if (!raw || raw.status !== ACTIVE_TOKEN_STATUS) continue;
    tokenMap.set(
      addr,
      buildSwapToken(
        raw,
        prices.get(addr) || "0",
        balances.get(addr)!.toString(),
        getTokenBalance(raw, userAddress)
      )
    );
  }
};

export const getTradeTokens = async (accessToken: string, userAddress: string): Promise<SwapToken[]> => {
  const [tokens, v3Balances] = await Promise.all([
    getSwapableTokens(accessToken, userAddress),
    getV3FundedTokenBalances(accessToken),
  ]);

  const tokenMap = new Map(tokens.map((t) => [t.address, t]));
  await mergeTokenBalances(accessToken, tokenMap, v3Balances, userAddress);
  return [...tokenMap.values()];
};

export const getTradePairableTokens = async (
  accessToken: string,
  tokenAddress: string,
  userAddress: string
): Promise<SwapToken[]> => {
  const [tokens, v3Balances] = await Promise.all([
    getSwapableTokenPairs(accessToken, tokenAddress, userAddress),
    getV3FundedTokenBalances(accessToken, tokenAddress),
  ]);

  const tokenMap = new Map(tokens.map((t) => [t.address, t]));
  await mergeTokenBalances(accessToken, tokenMap, v3Balances, userAddress);
  return [...tokenMap.values()];
};

// ============================================================================
// CANDIDATE DISCOVERY (composition + normalization to TradePool)
// ============================================================================

interface TradeCandidate {
  pool: TradePool;
  /** oriented reserves for direct v2 quoting */
  v2?: { reserveIn: bigint; reserveOut: bigint; feeBps: bigint };
  /** v3 orientation for the requested pair */
  v3ZeroForOne?: boolean;
}

const toWadRate = (decimalString: string | undefined): bigint => {
  const value = parseFloat(decimalString || "0");
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.round(value * 1e18));
};

const oracleRateWadFor = (priceIn: bigint, priceOut: bigint): string | undefined =>
  priceIn > 0n && priceOut > 0n ? ((priceIn * WAD) / priceOut).toString() : undefined;

/** USD value (plain number) of wei-scaled balances priced by wei-scaled oracle prices */
const usdValue = (entries: { balance: bigint; price: bigint }[]): number =>
  entries.reduce((sum, { balance, price }) => sum + Number((balance * price) / WAD) / 1e18, 0);

const buildSide = (
  address: string,
  meta: RawToken | undefined,
  fallback: { name?: string; symbol?: string; decimals?: number } | undefined,
  poolBalance: string
): TradePoolSide => ({
  address,
  symbol: meta?._symbol ?? fallback?.symbol ?? "",
  name: meta?._name ?? fallback?.name ?? "",
  decimals: meta?.customDecimals ?? fallback?.decimals ?? 18,
  poolBalance,
});

const pairCandidateToTrade = (
  row: PairPoolCandidate,
  a: string,
  metaIn: RawToken | undefined,
  metaOut: RawToken | undefined,
  priceIn: bigint,
  priceOut: bigint,
  oracleRateWad: string | undefined
): TradeCandidate => {
  const inIsA = row.tokenA.address === a;
  const reserveIn = BigInt(inIsA ? row.tokenABalance : row.tokenBBalance);
  const reserveOut = BigInt(inIsA ? row.tokenBBalance : row.tokenABalance);

  const totalLiquidityUSD = usdValue([
    { balance: BigInt(row.tokenABalance), price: inIsA ? priceIn : priceOut },
    { balance: BigInt(row.tokenBBalance), price: inIsA ? priceOut : priceIn },
  ]);

  // stable pools store their live spot ratio on-chain; V2 spot is the reserve ratio
  const storedRatioWad = toWadRate(inIsA ? row.aToBRatio : row.bToARatio);
  const spotRateWad = row.isStable
    ? (storedRatioWad > 0n ? storedRatioWad : BigInt(oracleRateWad ?? "0"))
    : (reserveOut * WAD) / reserveIn;

  return {
    pool: {
      address: row.address,
      poolType: row.isStable ? "stable" : "v2",
      poolLabel: row.isStable ? "Stable" : "V2",
      feeBps: row.feeBps,
      tokenIn: buildSide(a, metaIn, undefined, reserveIn.toString()),
      tokenOut: buildSide(inIsA ? row.tokenB.address : row.tokenA.address, metaOut, undefined, reserveOut.toString()),
      spotRateWad: spotRateWad.toString(),
      oracleRateWad,
      totalLiquidityUSD,
      isPaused: row.isPaused,
      isDisabled: row.isDisabled,
    },
    v2: row.isStable ? undefined : { reserveIn, reserveOut, feeBps: BigInt(row.feeBps) },
  };
};

/**
 * All pools that can trade tokenIn -> tokenOut, across the three pool types,
 * normalized and oriented to the requested direction.
 */
export const findCandidatePools = async (
  accessToken: string,
  tokenIn: string,
  tokenOut: string
): Promise<TradeCandidate[]> => {
  const a = normalizeAddress(tokenIn);
  const b = normalizeAddress(tokenOut);
  if (a === b) throw new Error("Cannot trade a token with itself");

  const [v2StableCandidates, v3Pools, tokenMeta, priceMap] = await Promise.all([
    getPairPoolCandidates(accessToken, a, b),
    getV3PoolsByPair(accessToken, a, b),
    fetchTokenMetadata(accessToken, [a, b]),
    getOraclePrices(accessToken, { select: "asset:key,price:value::text", key: `in.(${a},${b})` }),
  ]);

  const priceIn = BigInt(priceMap.get(a) || "0");
  const priceOut = BigInt(priceMap.get(b) || "0");
  const oracleRateWad = oracleRateWadFor(priceIn, priceOut);
  const metaIn = tokenMeta.get(a);
  const metaOut = tokenMeta.get(b);

  const candidates: TradeCandidate[] = v2StableCandidates.pools.map((row) =>
    pairCandidateToTrade(row, a, metaIn, metaOut, priceIn, priceOut, oracleRateWad)
  );

  // --- multi-token stable pools ---
  const multis = v2StableCandidates.multiTokenPools;
  if (multis.length > 0) {
    // TVL spans every coin in the pool, not just the traded pair
    const extraCoins = [
      ...new Set(multis.flatMap((pool) => pool.coins.map((c) => c.tokenAddress.toLowerCase()))),
    ].filter((addr) => addr !== a && addr !== b);
    const extraPrices = extraCoins.length > 0
      ? await getOraclePrices(accessToken, {
          select: "asset:key,price:value::text",
          key: `in.(${extraCoins.join(",")})`,
        })
      : new Map<string, string>();
    const priceOf = (addr: string): bigint =>
      addr === a ? priceIn : addr === b ? priceOut : BigInt(extraPrices.get(addr) || "0");

    for (const pool of multis) {
      const totalLiquidityUSD = usdValue(
        pool.coins.map((c) => {
          const addr = c.tokenAddress.toLowerCase();
          return {
            balance: BigInt(pool.tokenBalances.get(addr) || pool.tokenBalances.get(c.tokenAddress) || "0"),
            price: priceOf(addr),
          };
        })
      );

      candidates.push({
        pool: {
          address: pool.address,
          poolType: "stable",
          poolLabel: "Stable",
          feeBps: pool.feeBps,
          tokenIn: buildSide(a, metaIn, undefined, pool.tokenBalances.get(a) || "0"),
          tokenOut: buildSide(b, metaOut, undefined, pool.tokenBalances.get(b) || "0"),
          // pre-quote display estimate; exact spot arrives with the quote
          spotRateWad: oracleRateWad ?? "0",
          oracleRateWad,
          totalLiquidityUSD,
          isPaused: pool.isPaused,
          isDisabled: pool.isDisabled,
        },
      });
    }
  }

  // --- V3 pools (one per fee tier; getPoolsByPair already excludes disabled) ---
  for (const pool of v3Pools) {
    const zeroForOne = pool.token0.address === a;
    const priceWad = BigInt(pool.priceWad || "0");
    const oracleWad = BigInt(pool.oraclePriceWad || "0");
    const orient = (wad: bigint): bigint =>
      wad === 0n ? 0n : zeroForOne ? wad : (WAD * WAD) / wad;

    candidates.push({
      pool: {
        address: pool.address,
        poolType: "v3",
        poolLabel: `V3 ${pool.fee / 10000}%`,
        feeBps: pool.fee / 100,
        tokenIn: buildSide(a, metaIn, zeroForOne ? pool.token0 : pool.token1, zeroForOne ? pool.token0Balance : pool.token1Balance),
        tokenOut: buildSide(b, metaOut, zeroForOne ? pool.token1 : pool.token0, zeroForOne ? pool.token1Balance : pool.token0Balance),
        spotRateWad: orient(priceWad).toString(),
        oracleRateWad: oracleWad > 0n ? orient(oracleWad).toString() : oracleRateWad,
        totalLiquidityUSD: pool.totalLiquidityUSD,
        isPaused: pool.isPaused,
        isDisabled: pool.isDisabled,
      },
      v3ZeroForOne: zeroForOne,
    });
  }

  return candidates;
};

export const getTradePools = async (
  accessToken: string,
  tokenIn: string,
  tokenOut: string
): Promise<TradePool[]> => {
  const candidates = await findCandidatePools(accessToken, tokenIn, tokenOut);
  return candidates.map((c) => c.pool);
};

// ============================================================================
// QUOTES
// ============================================================================

const errorQuote = (candidate: TradeCandidate, exactOut: boolean, message: string): TradeQuote => ({
  poolAddress: candidate.pool.address,
  poolType: candidate.pool.poolType,
  poolLabel: candidate.pool.poolLabel,
  tokenIn: candidate.pool.tokenIn.address,
  tokenOut: candidate.pool.tokenOut.address,
  exactOut,
  amountIn: "0",
  amountOut: "0",
  feeAmount: "0",
  feeBps: candidate.pool.feeBps,
  priceImpact: 0,
  poolTvlUsd: candidate.pool.totalLiquidityUSD,
  error: message,
});

const priceImpactPercent = (execWad: bigint, spotWad: bigint): number => {
  if (spotWad <= 0n) return 0;
  const exec = Number(execWad) / 1e18;
  const spot = Number(spotWad) / 1e18;
  return Math.abs((exec - spot) / spot) * 100;
};

const quoteCandidate = async (
  accessToken: string,
  candidate: TradeCandidate,
  tokenIn: string,
  tokenOut: string,
  amount: bigint,
  exactOut: boolean
): Promise<TradeQuote> => {
  const { pool } = candidate;
  const base = {
    poolAddress: pool.address,
    poolType: pool.poolType,
    poolLabel: pool.poolLabel,
    tokenIn: pool.tokenIn.address,
    tokenOut: pool.tokenOut.address,
    exactOut,
    poolTvlUsd: pool.totalLiquidityUSD,
  };

  if (pool.poolType === "v2") {
    if (pool.isPaused) throw new Error("Pool is paused");
    const { reserveIn, reserveOut, feeBps } = candidate.v2!;
    const result = exactOut
      ? getV2QuoteExactOut(amount, reserveIn, reserveOut, feeBps)
      : getV2QuoteExactIn(amount, reserveIn, reserveOut, feeBps);
    if (result.amountOut <= 0n) throw new Error("Pool has insufficient liquidity for this trade");
    const spotWad = (reserveOut * WAD) / reserveIn;
    const execWad = (result.amountOut * WAD) / result.amountIn;
    return {
      ...base,
      amountIn: result.amountIn.toString(),
      amountOut: result.amountOut.toString(),
      feeAmount: result.feeAmount.toString(),
      feeBps: Number(feeBps),
      priceImpact: priceImpactPercent(execWad, spotWad),
      spotRateWad: spotWad.toString(),
    };
  }

  if (pool.poolType === "stable") {
    const quote = await getStableQuote(
      accessToken,
      pool.address,
      tokenIn,
      tokenOut,
      exactOut ? -amount : amount
    );
    return {
      ...base,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      feeAmount: quote.feeAmount,
      feeBps: quote.fee,
      priceImpact: quote.priceImpact,
      spotRateWad: quote.spotRateWad,
    };
  }

  // v3
  const quote = await getV3Quote(
    accessToken,
    pool.address,
    candidate.v3ZeroForOne!,
    exactOut ? -amount : amount
  );
  if (BigInt(quote.amountOut) <= 0n) throw new Error("Pool has insufficient liquidity for this trade");
  return {
    ...base,
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    feeAmount: quote.feeAmount,
    feeBps: quote.fee / 100,
    priceImpact: quote.priceImpact,
    spotRateWad: pool.spotRateWad,
    partialFill: quote.partialFill,
  };
};

export const getTradeQuotes = async (
  accessToken: string,
  tokenIn: string,
  tokenOut: string,
  amount: bigint,
  type: "EXACT_INPUT" | "EXACT_OUTPUT"
): Promise<TradeQuoteResponse> => {
  if (amount <= 0n) throw new Error("Amount must be greater than 0");
  const exactOut = type === "EXACT_OUTPUT";

  const candidates = await findCandidatePools(accessToken, tokenIn, tokenOut);
  if (candidates.length === 0) {
    // a pair with no pools is a valid, empty answer — the UI transiently holds
    // un-pairable combos while the user switches tokens (the To token corrects
    // itself once the pairable list loads)
    return {
      tokenIn: normalizeAddress(tokenIn),
      tokenOut: normalizeAddress(tokenOut),
      amount: amount.toString(),
      type,
      quotes: [],
      bestPoolAddress: null,
    };
  }

  const quotes = await Promise.all(
    candidates.map((candidate) =>
      quoteCandidate(accessToken, candidate, tokenIn, tokenOut, amount, exactOut).catch(
        (err: Error) => errorQuote(candidate, exactOut, err.message)
      )
    )
  );

  const activeByAddress = new Map(candidates.map((c) => [c.pool.address, !c.pool.isPaused && !c.pool.isDisabled]));
  const executable = quotes.filter(
    (q) =>
      !q.error &&
      activeByAddress.get(q.poolAddress) &&
      !(exactOut && q.partialFill) &&
      BigInt(q.amountOut) > 0n &&
      BigInt(q.amountIn) > 0n
  );

  let best: TradeQuote | null = null;
  for (const quote of executable) {
    if (!best) { best = quote; continue; }
    const better = exactOut
      ? BigInt(quote.amountIn) < BigInt(best.amountIn)
      : BigInt(quote.amountOut) > BigInt(best.amountOut);
    if (better) best = quote;
  }

  return {
    tokenIn: normalizeAddress(tokenIn),
    tokenOut: normalizeAddress(tokenOut),
    amount: amount.toString(),
    type,
    quotes,
    bestPoolAddress: best?.poolAddress ?? null,
  };
};

// ============================================================================
// EXECUTION
// ============================================================================

/**
 * One execute entrypoint for all pool types: identifies which contract the
 * pool address belongs to (via the domain services) and dispatches to the
 * matching swap call. StablePool is checked before Pool because 2-coin stable
 * pools exist in both tables — they execute via exchange(i,j,...), the same
 * path their quote simulated.
 */
export const executeTradeSwap = async (
  accessToken: string,
  params: TradeSwapParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const poolAddress = normalizeAddress(params.poolAddress);
  const tokenIn = normalizeAddress(params.tokenIn);
  const tokenOut = normalizeAddress(params.tokenOut);
  if (tokenIn === tokenOut) throw new Error("Cannot trade a token with itself");
  const deadline = Math.floor(Date.now() / 1000) + TRADE_DEADLINE_SECONDS;

  // stable? (checked first: 2-coin stables also have a Pool-table row)
  const stableCoins = await fetchPoolCoins(accessToken, poolAddress);
  if (stableCoins.length > 0) {
    return exchangeMultiToken(
      accessToken,
      { poolAddress, tokenIn, tokenOut, amountIn: params.amountIn, minAmountOut: params.minAmountOut, deadline },
      userAddress
    );
  }

  // v3?
  const v3Pairs = await getV3PoolTokenPairs(accessToken, [poolAddress]);
  const v3Pair = v3Pairs.get(poolAddress);
  if (v3Pair) {
    const zeroForOne = v3Pair.token0 === tokenIn;
    if (!zeroForOne && v3Pair.token1 !== tokenIn) throw new Error(`Token ${params.tokenIn} not found in pool`);
    if ((zeroForOne ? v3Pair.token1 : v3Pair.token0) !== tokenOut) throw new Error(`Token ${params.tokenOut} not found in pool`);
    return executeV3Swap(
      accessToken,
      {
        poolAddress,
        zeroForOne,
        // always executed as exact input; the slippage floor maps to amountLimit
        amountSpecified: params.amountIn,
        amountLimit: params.minAmountOut,
      },
      userAddress
    );
  }

  // v2?
  const pool = await fetchPoolTokenAddresses(accessToken, poolAddress);
  if (!pool) throw new Error(`Pool not found: ${params.poolAddress}`);
  const isAToB = pool.tokenA === tokenIn;
  if (!isAToB && pool.tokenB !== tokenIn) throw new Error(`Token ${params.tokenIn} not found in pool`);
  if ((isAToB ? pool.tokenB : pool.tokenA) !== tokenOut) throw new Error(`Token ${params.tokenOut} not found in pool`);
  return executeV2Swap(
    accessToken,
    { poolAddress, isAToB, amountIn: params.amountIn, minAmountOut: params.minAmountOut, deadline },
    userAddress
  );
};
