/**
 * PoolV3 (concentrated liquidity) service — self-contained: reads PoolV3/PoolV3Factory
 * Cirrus tables, quotes swaps by simulating the contract's tick-walking loop over
 * indexed tick data, and builds/submits PoolV3 transactions. No V2 pool code paths.
 */
import { cirrus } from "../../utils/appApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { executeTransaction } from "../../utils/txHelper";
import * as config from "../../config/config";
import {
  POOL_V3_CONTRACTS,
  POOL_V3_SELECT_FIELDS,
  POOL_V3_TICK_SELECT_FIELDS,
  POOL_V3_POSITION_SELECT_FIELDS,
  POOL_V3_SWAP_HISTORY_SELECT_FIELDS,
  V3_DEADLINE_SECONDS,
} from "../../config/poolV3Constants";
import * as v3 from "../helpers/poolV3Math.helper";
import { toUTCTime } from "../helpers/cirrusHelpers";
import { getOraclePrices } from "./oracle.service";
import {
  PoolV3,
  PoolV3Token,
  PoolV3Quote,
  PoolV3Position,
  PoolV3AmountsPreview,
  PoolV3SwapParams,
  PoolV3MintParams,
  PoolV3BurnParams,
  PoolV3CollectParams,
  PoolV3CreateParams,
  TransactionResponse,
  SwapHistoryEntry,
  PoolV3LiquidityDistribution,
} from "@strato/shared-types";

const {
  PoolV3: PoolV3Table,
  PoolV3Ticks,
  PoolV3Positions,
  PoolV3SwapEvent,
} = POOL_V3_CONTRACTS;

const normalizeAddress = (address: string): string => address.toLowerCase().replace(/^0x/, "");

/**
 * Parse a Cirrus numeric field to a bigint, or `undefined` when the indexer mis-serialized it.
 * The storage decoder currently emits large signed-int struct fields (feeGrowthOutside*,
 * feeGrowthInside*Last) as `{"length":"…"}` objects or non-decimal strings instead of a
 * decimal. Those aren't BigInt-convertible (and would throw), so treat them as unavailable —
 * callers must skip any computation that depends on the value rather than assume 0.
 */
const toBigIntOrUndefined = (v: unknown): bigint | undefined => {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  return undefined;
};
const deadline = (): number => Math.floor(Date.now() / 1000) + V3_DEADLINE_SECONDS;

const approvalTx = (tokenAddress: string, spender: string, amount: string) => ({
  contractName: "Token",
  contractAddress: tokenAddress,
  method: "approve",
  args: { spender, value: amount },
});

// ============================================================================
// RAW ROW SHAPES (Cirrus)
// ============================================================================

interface RawV3Token {
  address: string;
  _name: string;
  _symbol: string;
  customDecimals: number | null;
  status: string;
  images?: { value: string }[];
}

interface RawV3Pool {
  address: string;
  fee: number;
  tickSpacing: number;
  sqrtPriceX96: string;
  currentTick: number;
  liquidity: string;
  feeGrowthGlobal0X128: string;
  feeGrowthGlobal1X128: string;
  feeProtocol: number;
  protocolFees0: string;
  protocolFees1: string;
  token0Balance: string;
  token1Balance: string;
  token0: RawV3Token;
  token1: RawV3Token;
  isPaused: boolean;
  isDisabled: boolean;
}

interface RawV3Tick {
  key: string; // tick index (mapping key)
  block_number: string; // latest write — disambiguates ghost rows for the same tick
  liquidityNet: string;
  liquidityGross: string;
  initialized: string; // "true" | "false" — read from the value JSONB via ->>, so it is text
  feeGrowthOutside0X128: string | null; // signed Q128 (null until first written)
  feeGrowthOutside1X128: string | null;
}

interface RawV3Position {
  address: string; // pool address
  key: string; // owner
  key2: string; // tickLower (nested-mapping keys are key/key2/key3, no underscore)
  key3: string; // tickUpper
  liquidity: string;
  tokensOwed0: string;
  tokensOwed1: string;
  feeGrowthInside0LastX128: string | null; // signed Q128 snapshot at last touch
  feeGrowthInside1LastX128: string | null;
}

interface RawV3SwapEvent {
  address: string; // pool the swap executed in
  id: number;
  block_timestamp: string;
  sender: string;
  recipient: string;
  amount0: string; // signed delta: positive = paid to the pool (input side)
  amount1: string;
}

// ============================================================================
// BUILDERS
// ============================================================================

const buildToken = (raw: RawV3Token): PoolV3Token => ({
  address: raw.address,
  name: raw._name,
  symbol: raw._symbol,
  decimals: raw.customDecimals ?? 18,
  image: raw.images?.[0]?.value,
});

/** Per-pool 24h swap input sums, in token terms (token0-in and token1-in separately) */
interface SwapInputs24h {
  in0: bigint;
  in1: bigint;
}

/**
 * 24h swap inputs per pool from the Swap event table. Each event's positive signed
 * delta is the trade's input side; summing per token lets the caller value the
 * volume at oracle prices.
 */
const fetchSwapInputs24h = async (
  accessToken: string,
  poolAddresses: string[]
): Promise<Map<string, SwapInputs24h>> => {
  const sums = new Map<string, SwapInputs24h>();
  if (poolAddresses.length === 0) return sums;
  try {
    const { data } = await cirrus.get(accessToken, `/${PoolV3SwapEvent}`, {
      params: {
        address: `in.(${poolAddresses.join(",")})`,
        select: "address,amount0,amount1",
        block_timestamp: `gte.${toUTCTime(new Date(Date.now() - 24 * 60 * 60 * 1000))}`,
      },
    });
    for (const ev of (data as { address: string; amount0: string; amount1: string }[]) ?? []) {
      const amount0 = toBigIntOrUndefined(ev.amount0) ?? 0n;
      const amount1 = toBigIntOrUndefined(ev.amount1) ?? 0n;
      const cur = sums.get(ev.address) || { in0: 0n, in1: 0n };
      if (amount0 > 0n) cur.in0 += amount0;
      else if (amount1 > 0n) cur.in1 += amount1;
      sums.set(ev.address, cur);
    }
  } catch {
    // the event table is created lazily on the first swap — no swaps means zero volume
  }
  return sums;
};

/** wei balance valued at the oracle price (18-decimal wei), as a plain USD number */
const usdAmount = (priceMap: Map<string, string>, tokenAddress: string, balance: string): number => {
  const price = priceMap.get(tokenAddress);
  if (!price) return 0;
  return Number((BigInt(balance) * BigInt(price)) / 10n ** 18n) / 1e18;
};

/**
 * 24h fee income kept by LPs, in USD. The fee tier is in pips (1e6 denominator);
 * the protocol cut (packed denominators d0 + (d1 << 4), 0 = off) is deducted
 * from what LPs keep.
 */
const lpFees24hUSD = (raw: RawV3Pool, volume24hUSD: number): number => {
  const d0 = Number(raw.feeProtocol) % 16;
  const d1 = Math.floor(Number(raw.feeProtocol) / 16);
  const lpFraction = 1 - ((d0 > 0 ? 1 / d0 : 0) + (d1 > 0 ? 1 / d1 : 0)) / 2;
  return volume24hUSD * (Number(raw.fee) / 1e6) * lpFraction;
};

const volume24hUSDFor = (raw: RawV3Pool, priceMap: Map<string, string>, swapInputs?: SwapInputs24h): number =>
  swapInputs
    ? usdAmount(priceMap, raw.token0.address, swapInputs.in0.toString()) +
      usdAmount(priceMap, raw.token1.address, swapInputs.in1.toString())
    : 0;

const buildPool = (raw: RawV3Pool, priceMap: Map<string, string>, swapInputs?: SwapInputs24h): PoolV3 => {
  const priceWad = v3.sqrtPriceX96ToPriceWad(BigInt(raw.sqrtPriceX96));
  const usd = (tokenAddress: string, balance: string): number => usdAmount(priceMap, tokenAddress, balance);
  // oracle spot price of the pair (token1 per token0, same orientation as priceWad)
  const price0 = BigInt(priceMap.get(raw.token0.address) ?? "0");
  const price1 = BigInt(priceMap.get(raw.token1.address) ?? "0");
  const oraclePriceWad = price0 > 0n && price1 > 0n ? (price0 * 10n ** 18n) / price1 : 0n;

  const totalLiquidityUSD = usd(raw.token0.address, raw.token0Balance) + usd(raw.token1.address, raw.token1Balance);
  const volume24hUSD = volume24hUSDFor(raw, priceMap, swapInputs);
  const fees24hUSD = lpFees24hUSD(raw, volume24hUSD);
  const apy = totalLiquidityUSD > 0 ? Math.max(0, (fees24hUSD / totalLiquidityUSD) * 365 * 100) : 0;

  return {
    address: raw.address,
    token0: buildToken(raw.token0),
    token1: buildToken(raw.token1),
    fee: Number(raw.fee),
    tickSpacing: Number(raw.tickSpacing),
    sqrtPriceX96: raw.sqrtPriceX96,
    currentTick: Number(raw.currentTick),
    liquidity: raw.liquidity,
    priceWad: priceWad.toString(),
    oraclePriceWad: oraclePriceWad.toString(),
    token0Balance: raw.token0Balance,
    token1Balance: raw.token1Balance,
    feeProtocol: Number(raw.feeProtocol),
    protocolFees0: raw.protocolFees0,
    protocolFees1: raw.protocolFees1,
    totalLiquidityUSD,
    volume24hUSD,
    apy,
    isPaused: raw.isPaused,
    isDisabled: raw.isDisabled,
    poolName: `${raw.token0._symbol}/${raw.token1._symbol} ${Number(raw.fee) / 10000}%`,
  };
};

// ============================================================================
// READ OPERATIONS
// ============================================================================

const fetchRawPools = async (
  accessToken: string,
  filters: Record<string, string> = {},
  opts: { anyFactory?: boolean } = {},
): Promise<RawV3Pool[]> => {
  const { data } = await cirrus.get(accessToken, `/${PoolV3Table}`, {
    params: {
      // Portfolio valuation must see positions on every factory; discovery/trade
      // listing stays pinned to the configured current factory.
      ...(opts.anyFactory ? {} : { poolV3Factory: `eq.${config.poolV3Factory}` }),
      select: POOL_V3_SELECT_FIELDS.join(","),
      // uninitialized proxies/implementations have price 0
      sqrtPriceX96: "neq.0",
      ...filters,
    },
  });
  return data as RawV3Pool[];
};

const attachPrices = async (accessToken: string, rawPools: RawV3Pool[]): Promise<PoolV3[]> => {
  if (rawPools.length === 0) return [];
  const tokenAddresses = [
    ...new Set(rawPools.flatMap((p) => [p.token0.address, p.token1.address])),
  ];
  const [priceMap, swapInputs] = await Promise.all([
    getOraclePrices(accessToken, {
      select: "asset:key,price:value::text",
      key: `in.(${tokenAddresses.join(",")})`,
    }),
    fetchSwapInputs24h(accessToken, rawPools.map((p) => p.address)),
  ]);
  return rawPools.map((raw) => buildPool(raw, priceMap, swapInputs.get(raw.address)));
};

export const getPools = async (accessToken: string): Promise<PoolV3[]> => {
  const rawPools = await fetchRawPools(accessToken);
  const pools = await attachPrices(accessToken, rawPools);
  return pools.sort((a, b) => b.totalLiquidityUSD - a.totalLiquidityUSD);
};

export const getPoolByAddress = async (accessToken: string, poolAddress: string): Promise<PoolV3 | null> => {
  const rawPools = await fetchRawPools(accessToken, { address: `eq.${normalizeAddress(poolAddress)}` });
  const pools = await attachPrices(accessToken, rawPools);
  return pools[0] ?? null;
};

/** All V3 pools (any fee tier, either token order) for a token pair, deepest liquidity first */
export const getPoolsByPair = async (accessToken: string, tokenA: string, tokenB: string): Promise<PoolV3[]> => {
  const a = normalizeAddress(tokenA);
  const b = normalizeAddress(tokenB);
  const rawPools = await fetchRawPools(accessToken, {
    or: `(and(token0.eq.${a},token1.eq.${b}),and(token0.eq.${b},token1.eq.${a}))`,
  });
  const pools = await attachPrices(accessToken, rawPools);
  return pools
    .filter((p) => !p.isDisabled)
    .sort((x, y) => y.totalLiquidityUSD - x.totalLiquidityUSD);
};

/**
 * Token discovery for the unified trade surface: the max funded balance per
 * token across active (not disabled, funded on both sides) V3 pools. With
 * `pairedWith` set, returns only counterparty tokens of pools containing that
 * token, valued at their counterparty-side balance.
 */
export const getFundedPoolTokenBalances = async (
  accessToken: string,
  pairedWith?: string
): Promise<Map<string, bigint>> => {
  const paired = pairedWith ? normalizeAddress(pairedWith) : undefined;
  const { data } = await cirrus.get(accessToken, `/${PoolV3Table}`, {
    params: {
      isDisabled: "eq.false",
      isPaused: "eq.false",
      select: "address,token0,token1,token0Balance::text,token1Balance::text",
      ...(paired ? { or: `(token0.eq.${paired},token1.eq.${paired})` } : {}),
    },
  });

  const balances = new Map<string, bigint>();
  const bump = (token: string, balance: bigint) => {
    if (balance > (balances.get(token) ?? 0n)) balances.set(token, balance);
  };

  type Row = { address: string; token0: string; token1: string; token0Balance: string; token1Balance: string };
  for (const row of (data as Row[]) ?? []) {
    if (config.hiddenSwapPools.has(row.address)) continue;
    const balance0 = BigInt(row.token0Balance || "0");
    const balance1 = BigInt(row.token1Balance || "0");
    if (balance0 <= 0n || balance1 <= 0n) continue;
    if (paired) {
      bump(row.token0 === paired ? row.token1 : row.token0, row.token0 === paired ? balance1 : balance0);
    } else {
      bump(row.token0, balance0);
      bump(row.token1, balance1);
    }
  }
  return balances;
};

/** Minimal token0/token1 lookup for a set of pools (portfolio valuation) */
export const getPoolTokenPairs = async (
  accessToken: string,
  poolAddresses: string[]
): Promise<Map<string, { token0: string; token1: string }>> => {
  const pairs = new Map<string, { token0: string; token1: string }>();
  if (poolAddresses.length === 0) return pairs;
  const { data } = await cirrus.get(accessToken, `/${PoolV3Table}`, {
    params: {
      address: `in.(${poolAddresses.map(normalizeAddress).join(",")})`,
      select: "address,token0,token1",
    },
  });
  for (const row of (data as { address: string; token0: string; token1: string }[]) ?? []) {
    if (row.token0 && row.token1) pairs.set(row.address, { token0: row.token0, token1: row.token1 });
  }
  return pairs;
};

/**
 * The newest `maxRows` swaps for a token pair across ALL of its V3 pools (every fee
 * tier, either token order), plus the pair's total V3 swap count. Feeds the unified
 * V2+V3 pair history endpoint in swapping.service, which merge-sorts the venues and
 * paginates — hence top-N rather than page/offset here (a correct merged page K needs
 * the top K of each source).
 *
 * Entries use the V2 SwapHistoryEntry shape plus poolAddress/poolName/fee so the
 * table can show which pool each swap executed in. The event's amount0/amount1 are
 * the pool's signed deltas (positive = paid to the pool), so the sign of amount0
 * determines the trade direction. impliedPrice is normalized to tokenB-per-tokenA in
 * the REQUESTED pair order, so rows from pools with flipped token0/token1 ordering
 * still quote the same way.
 */
export const fetchPairSwapHistory = async (
  accessToken: string,
  tokenA: string,
  tokenB: string,
  maxRows: number,
  senderAddress?: string
): Promise<{ entries: SwapHistoryEntry[]; totalCount: number }> => {
  const a = normalizeAddress(tokenA);
  const b = normalizeAddress(tokenB);

  // raw rows rather than getPoolsByPair: history must include disabled pools' past
  // swaps, and the symbols/fee needed here don't require the oracle price pass
  const rawPools = await fetchRawPools(accessToken, {
    or: `(and(token0.eq.${a},token1.eq.${b}),and(token0.eq.${b},token1.eq.${a}))`,
  });
  if (rawPools.length === 0) return { entries: [], totalCount: 0 };
  const poolByAddress = new Map(rawPools.map((p) => [p.address, p]));

  // either side of the trade counts as the user's (the pool pays out to `recipient`)
  const senderFilter = senderAddress
    ? { or: `(sender.eq.${normalizeAddress(senderAddress)},recipient.eq.${normalizeAddress(senderAddress)})` }
    : {};
  const eventFilters = {
    address: `in.(${rawPools.map((p) => p.address).join(",")})`,
    ...senderFilter,
  };

  const [eventsResponse, countResponse] = await Promise.all([
    cirrus.get(accessToken, `/${PoolV3SwapEvent}`, {
      params: {
        ...eventFilters,
        select: POOL_V3_SWAP_HISTORY_SELECT_FIELDS.join(","),
        order: "block_timestamp.desc",
        limit: maxRows.toString(),
      },
    }),
    cirrus.get(accessToken, `/${PoolV3SwapEvent}`, {
      params: { ...eventFilters, select: "count()" },
    }),
  ]);

  const swapEvents = eventsResponse.data;
  const totalCount = countResponse.data?.[0]?.count || 0;
  if (!Array.isArray(swapEvents)) return { entries: [], totalCount: 0 };

  const entries: SwapHistoryEntry[] = (swapEvents as RawV3SwapEvent[]).flatMap((event) => {
    const pool = poolByAddress.get(event.address);
    if (!pool) return [];
    const amount0 = toBigIntOrUndefined(event.amount0) ?? 0n;
    const amount1 = toBigIntOrUndefined(event.amount1) ?? 0n;
    const zeroForOne = amount0 > 0n;
    const amountIn = zeroForOne ? amount0 : amount1;
    const amountOut = -(zeroForOne ? amount1 : amount0);
    const token0Amount = zeroForOne ? amountIn : amountOut;
    const token1Amount = zeroForOne ? amountOut : amountIn;
    // execution price as tokenB per tokenA in the requested order (V2's "TokenB/TokenA")
    const [baseAmount, quoteAmount] =
      pool.token0.address === a ? [token0Amount, token1Amount] : [token1Amount, token0Amount];
    const impliedPrice =
      baseAmount > 0n && quoteAmount > 0n
        ? (Number((quoteAmount * 10n ** 18n) / baseAmount) / 1e18).toFixed(6)
        : "0.00";
    return [{
      id: event.id,
      timestamp: new Date(event.block_timestamp),
      tokenIn: zeroForOne ? pool.token0._symbol : pool.token1._symbol,
      tokenOut: zeroForOne ? pool.token1._symbol : pool.token0._symbol,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      impliedPrice,
      sender: event.sender,
      poolAddress: pool.address,
      poolName: `V3 ${Number(pool.fee) / 10000}%`,
      fee: Number(pool.fee),
    }];
  });

  return { entries, totalCount };
};

/**
 * Liquidity distribution across the price axis (depth-chart data): walk the pool's
 * initialized ticks in order accumulating liquidityNet — the running sum is the active
 * liquidity everywhere inside [tick_i, tick_i+1). Zero-liquidity gaps are omitted.
 * Returns null when the pool doesn't exist.
 */
export const getLiquidityDistribution = async (
  accessToken: string,
  poolAddress: string
): Promise<PoolV3LiquidityDistribution | null> => {
  const [rawPools, ticks] = await Promise.all([
    fetchRawPools(accessToken, { address: `eq.${normalizeAddress(poolAddress)}` }),
    fetchInitializedTicks(accessToken, poolAddress),
  ]);
  const pool = rawPools[0];
  if (!pool) return null;

  const sorted = [...ticks].sort((x, y) => x.tick - y.tick);
  const segments: PoolV3LiquidityDistribution["segments"] = [];
  let running = 0n;
  for (let i = 0; i < sorted.length - 1; i++) {
    running += sorted[i].liquidityNet;
    // ghost/mis-indexed tick rows could push the walk negative — clamp, never emit nonsense
    if (running < 0n) running = 0n;
    if (running > 0n) {
      segments.push({
        tickLower: sorted[i].tick,
        tickUpper: sorted[i + 1].tick,
        liquidity: running.toString(),
      });
    }
  }

  return {
    currentTick: Number(pool.currentTick),
    tickSpacing: Number(pool.tickSpacing),
    liquidity: pool.liquidity,
    segments,
  };
};

const fetchInitializedTicks = async (accessToken: string, poolAddress: string): Promise<v3.TickData[]> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${PoolV3Ticks}`, {
      params: {
        address: `eq.${normalizeAddress(poolAddress)}`,
        // `initialized` is a struct field inside the value JSONB, not a top-level column,
        // so it cannot be a server-side filter here — filter the fetched rows below.
        select: POOL_V3_TICK_SELECT_FIELDS.join(","),
      },
    });
    // The table can hold ghost rows per tick: zero-valued rows materialized by reads,
    // sometimes in the SAME block as the real write (observed on node5). Keep one row
    // per tick — newest block wins, and within a block a real (initialized) write beats
    // a zeroed ghost. A duplicated initialized tick would otherwise be crossed twice
    // in the swap simulation.
    const betterRow = (a: RawV3Tick, b: RawV3Tick): RawV3Tick => {
      const blockA = Number(a.block_number || 0);
      const blockB = Number(b.block_number || 0);
      if (blockA !== blockB) return blockA > blockB ? a : b;
      if (String(a.initialized) === "true" && String(b.initialized) !== "true") return a;
      if (String(b.initialized) === "true" && String(a.initialized) !== "true") return b;
      return a;
    };
    const newestByTick = new Map<number, RawV3Tick>();
    for (const t of data as RawV3Tick[]) {
      const tick = Number(t.key);
      const prev = newestByTick.get(tick);
      newestByTick.set(tick, prev ? betterRow(prev, t) : t);
    }
    return [...newestByTick.values()]
      .filter((t) => String(t.initialized) === "true" && t.liquidityNet != null)
      .map((t) => ({
        tick: Number(t.key),
        liquidityNet: BigInt(t.liquidityNet),
        // undefined when the indexer mis-serialized the field (a crossed tick's
        // feeGrowthOutside can arrive as {"length":...}); callers gate on this.
        feeGrowthOutside0X128: toBigIntOrUndefined(t.feeGrowthOutside0X128),
        feeGrowthOutside1X128: toBigIntOrUndefined(t.feeGrowthOutside1X128),
      }));
  } catch (err) {
    // A pool that has never been minted into has no rows in its ticks collection
    // table, so Cirrus has not materialized the struct columns (liquidityNet,
    // initialized, ...) yet — they are created lazily on first insert. PostgREST
    // then reports 42703 (undefined_column), or 42P01 (undefined_table) if the
    // table itself has not been created. Either way there are no initialized ticks,
    // which is exactly what an empty tick set means: the swap simply walks none.
    const code = (err as any)?.response?.data?.code;
    if (code === "42703" || code === "42P01") {
      return [];
    }
    throw err;
  }
};

// ============================================================================
// QUOTES
// ============================================================================

export const getQuote = async (
  accessToken: string,
  poolAddress: string,
  zeroForOne: boolean,
  amountSpecified: bigint // > 0 exact input, < 0 exact output
): Promise<PoolV3Quote> => {
  const rawPools = await fetchRawPools(accessToken, { address: `eq.${normalizeAddress(poolAddress)}` });
  const raw = rawPools[0];
  if (!raw) throw new Error(`PoolV3 not found: ${poolAddress}`);
  if (raw.isPaused || raw.isDisabled) throw new Error("Pool is not active");

  const ticks = await fetchInitializedTicks(accessToken, poolAddress);
  const state: v3.PoolQuoteState = {
    sqrtPriceX96: BigInt(raw.sqrtPriceX96),
    currentTick: Number(raw.currentTick),
    liquidity: BigInt(raw.liquidity),
    feePips: BigInt(raw.fee),
    ticks,
  };

  const result = v3.simulateSwap(state, zeroForOne, amountSpecified);

  // price impact: execution price vs pre-swap spot price (token1 per token0)
  let priceImpact = 0;
  if (result.amountIn > 0n && result.amountOut > 0n) {
    const spotWad = v3.sqrtPriceX96ToPriceWad(state.sqrtPriceX96);
    const execWad = zeroForOne
      ? (result.amountOut * 10n ** 18n) / result.amountIn
      : (result.amountIn * 10n ** 18n) / result.amountOut;
    const spot = Number(spotWad) / 1e18;
    const exec = Number(execWad) / 1e18;
    if (spot > 0) priceImpact = Math.abs((exec - spot) / spot) * 100;
  }

  return {
    poolAddress: raw.address,
    zeroForOne,
    exactOut: amountSpecified < 0n,
    amountIn: result.amountIn.toString(),
    amountOut: result.amountOut.toString(),
    feeAmount: result.feeAmount.toString(),
    fee: Number(raw.fee),
    sqrtPriceX96After: result.sqrtPriceX96After.toString(),
    tickAfter: result.tickAfter,
    priceImpact,
    partialFill: result.partialFill,
  };
};

// ============================================================================
// POSITIONS
// ============================================================================

export const getPositions = async (
  accessToken: string,
  owner: string,
  poolAddress?: string
): Promise<PoolV3Position[]> => {
  const params: Record<string, string> = {
    key: `eq.${normalizeAddress(owner)}`,
    select: POOL_V3_POSITION_SELECT_FIELDS.join(","),
  };
  if (poolAddress) params.address = `eq.${normalizeAddress(poolAddress)}`;

  let data: unknown;
  try {
    ({ data } = await cirrus.get(accessToken, `/${PoolV3Positions}`, {
      params: {
        ...params,
      },
    }));
  } catch (err) {
    // The position value columns (liquidity, tokensOwed0/1) are materialized lazily on
    // first insert; until any position is minted they do not exist and PostgREST returns
    // 42703 (undefined_column), or 42P01 (undefined_table) if the table is absent
    // entirely. Either way the owner has no positions. (The key columns key/key2/key3
    // are created up front, so this only guards the value-column selection.)
    const code = (err as any)?.response?.data?.code;
    if (code === "42703" || code === "42P01") return [];
    throw err;
  }

  const rows = (data as RawV3Position[]).filter(
    (r) => BigInt(r.liquidity ?? "0") > 0n || BigInt(r.tokensOwed0 ?? "0") > 0n || BigInt(r.tokensOwed1 ?? "0") > 0n
  );
  if (rows.length === 0) return [];

  // pool + tick state for amount and pending-fee computation
  const poolAddresses = [...new Set(rows.map((r) => r.address))];
  // anyFactory: user may hold liquidity on pools from older/alternate factories;
  // filtering to config.poolV3Factory silently dropped those from net-balance.
  const rawPools = await fetchRawPools(
    accessToken,
    { address: `in.(${poolAddresses.join(",")})` },
    { anyFactory: true },
  );
  const poolByAddress = new Map(rawPools.map((p) => [p.address, p]));
  console.log(
    `[NB-V3] getPositions owner=${owner} rows=${rows.length} poolsLoaded=${rawPools.length}/${poolAddresses.length}`
  );
  const ticksByPool = new Map<string, Map<number, v3.TickData>>();
  for (const addr of poolAddresses) {
    const ticks = await fetchInitializedTicks(accessToken, addr);
    ticksByPool.set(addr, new Map(ticks.map((t) => [t.tick, t])));
  }

  // fee income + prices for the per-position APY estimate
  const tokenAddresses = [...new Set(rawPools.flatMap((p) => [p.token0.address, p.token1.address]))];
  const [swapInputs24h, priceMap] = await Promise.all([
    fetchSwapInputs24h(accessToken, poolAddresses),
    getOraclePrices(accessToken, {
      select: "asset:key,price:value::text",
      key: `in.(${tokenAddresses.join(",")})`,
    }),
  ]);

  return rows.flatMap((row) => {
    const pool = poolByAddress.get(row.address);
    if (!pool) return [];
    const tickLower = Number(row.key2);
    const tickUpper = Number(row.key3);
    const liquidity = BigInt(row.liquidity);
    const { amount0, amount1 } = v3.getAmountsForLiquidity(
      BigInt(pool.sqrtPriceX96),
      Number(pool.currentTick),
      tickLower,
      tickUpper,
      liquidity,
      false
    );

    // Pending (unrealized) fees — the contract's Tick.getFeeGrowthInside + Position.update
    // math. Only computed when EVERY fee-growth input is readable: the indexer mis-serializes
    // feeGrowthOutside / feeGrowthInsideLast for some ticks/positions (the {"length":...}
    // form), so any input may be unavailable. When it is, we do NOT fabricate a number —
    // pending stays 0 and the fees are surfaced via "Collect fees" (which pokes the position
    // and realizes them into the clean tokensOwed).
    const lowerTick = ticksByPool.get(row.address)?.get(tickLower);
    const upperTick = ticksByPool.get(row.address)?.get(tickUpper);
    const feeGrowthInputs = [
      toBigIntOrUndefined(pool.feeGrowthGlobal0X128),
      toBigIntOrUndefined(pool.feeGrowthGlobal1X128),
      lowerTick?.feeGrowthOutside0X128,
      lowerTick?.feeGrowthOutside1X128,
      upperTick?.feeGrowthOutside0X128,
      upperTick?.feeGrowthOutside1X128,
      toBigIntOrUndefined(row.feeGrowthInside0LastX128),
      toBigIntOrUndefined(row.feeGrowthInside1LastX128),
    ];
    let pending0 = 0n;
    let pending1 = 0n;
    if (feeGrowthInputs.every((v) => v !== undefined)) {
      const [g0, g1, lo0, lo1, up0, up1, last0, last1] = feeGrowthInputs as bigint[];
      const { inside0, inside1 } = v3.getFeeGrowthInside(
        Number(pool.currentTick), tickLower, tickUpper, g0, g1, lo0, lo1, up0, up1
      );
      pending0 = v3.pendingFees(liquidity, inside0, last0);
      pending1 = v3.pendingFees(liquidity, inside1, last1);
    }

    // Estimated fee APY: an in-range position earns the pool's LP fee income in
    // proportion to its share of the CURRENT in-range liquidity (not of TVL —
    // that's the pool-level APY, which understates concentrated positions).
    // Out-of-range positions earn nothing until the price re-enters the range.
    const inRange = Number(pool.currentTick) >= tickLower && Number(pool.currentTick) < tickUpper;
    const positionValueUsd =
      usdAmount(priceMap, pool.token0.address, amount0.toString()) +
      usdAmount(priceMap, pool.token1.address, amount1.toString());
    const poolLiquidity = Number(pool.liquidity || "0");
    let apy = 0;
    if (inRange && positionValueUsd > 0 && poolLiquidity > 0) {
      const share = Math.min(1, Number(liquidity) / poolLiquidity);
      const fees24h = lpFees24hUSD(pool, volume24hUSDFor(pool, priceMap, swapInputs24h.get(row.address)));
      apy = Math.max(0, ((fees24h * share * 365) / positionValueUsd) * 100);
    }

    return [
      {
        poolAddress: row.address,
        owner: row.key,
        tickLower,
        tickUpper,
        liquidity: row.liquidity,
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        tokensOwed0: row.tokensOwed0,
        tokensOwed1: row.tokensOwed1,
        pendingFees0: pending0.toString(),
        pendingFees1: pending1.toString(),
        inRange,
        priceLowerWad: v3.sqrtPriceX96ToPriceWad(v3.getSqrtRatioAtTick(tickLower)).toString(),
        priceUpperWad: v3.sqrtPriceX96ToPriceWad(v3.getSqrtRatioAtTick(tickUpper)).toString(),
        apy,
      },
    ];
  });
};

/** Mint preview: token amounts for a liquidity value (or liquidity for token amounts) */
export const getAmountsForLiquidity = async (
  accessToken: string,
  poolAddress: string,
  tickLower: number,
  tickUpper: number,
  liquidity?: bigint,
  amount0Desired?: bigint,
  amount1Desired?: bigint
): Promise<PoolV3AmountsPreview> => {
  const rawPools = await fetchRawPools(accessToken, { address: `eq.${normalizeAddress(poolAddress)}` });
  const raw = rawPools[0];
  if (!raw) throw new Error(`PoolV3 not found: ${poolAddress}`);

  const sqrtPrice = BigInt(raw.sqrtPriceX96);
  const currentTick = Number(raw.currentTick);

  // Derive liquidity. When the caller specifies BOTH token amounts we take the canonical
  // min() (largest L that fits within both). When only ONE is specified — the usual UI
  // flow, where the user types one token and the other is computed — we derive L from that
  // single amount; min()-ing against the unspecified (zero) side would wrongly collapse an
  // in-range position's liquidity to 0.
  let liq = liquidity ?? 0n;
  if (liq === 0n) {
    const a0 = amount0Desired ?? 0n;
    const a1 = amount1Desired ?? 0n;
    if (a0 > 0n && a1 > 0n) {
      liq = v3.getLiquidityForAmounts(sqrtPrice, tickLower, tickUpper, a0, a1);
    } else if (a0 > 0n) {
      liq = v3.getLiquidityForAmount0(sqrtPrice, tickLower, tickUpper, a0);
    } else if (a1 > 0n) {
      liq = v3.getLiquidityForAmount1(sqrtPrice, tickLower, tickUpper, a1);
    }
  }
  const { amount0, amount1 } = v3.getAmountsForLiquidity(sqrtPrice, currentTick, tickLower, tickUpper, liq, true);
  return {
    amount0: amount0.toString(),
    amount1: amount1.toString(),
    liquidity: liq.toString(),
    tickLower,
    tickUpper,
  };
};

// ============================================================================
// WRITE OPERATIONS
// ============================================================================

const fetchPoolTokens = async (
  accessToken: string,
  poolAddress: string
): Promise<{ token0: string; token1: string }> => {
  const { data } = await cirrus.get(accessToken, `/${PoolV3Table}`, {
    params: {
      address: `eq.${normalizeAddress(poolAddress)}`,
      select: "token0,token1",
    },
  });
  const row = data?.[0];
  if (!row) throw new Error(`PoolV3 not found: ${poolAddress}`);
  return { token0: row.token0, token1: row.token1 };
};

export const swap = async (
  accessToken: string,
  params: PoolV3SwapParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, zeroForOne, amountSpecified, amountLimit, sqrtPriceLimitX96 } = params;
  const { token0, token1 } = await fetchPoolTokens(accessToken, poolAddress);
  const inputToken = zeroForOne ? token0 : token1;

  const specified = BigInt(amountSpecified);
  // exact input: approve the input amount; exact output: approve the max input (amountLimit)
  const approvalAmount = specified > 0n ? specified.toString() : amountLimit;

  const tx = await buildFunctionTx(
    [
      approvalTx(inputToken, poolAddress, approvalAmount),
      {
        contractName: "PoolV3",
        contractAddress: poolAddress,
        method: "swap",
        args: {
          recipient: userAddress,
          zeroForOne,
          amountSpecified,
          sqrtPriceLimitX96: sqrtPriceLimitX96 ?? "0",
          amountLimit,
          deadline: deadline(),
        },
      },
    ],
    userAddress,
    accessToken
  );
  return executeTransaction(accessToken, tx);
};

export const mint = async (
  accessToken: string,
  params: PoolV3MintParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, tickLower, tickUpper, liquidity, amount0Max, amount1Max } = params;
  const { token0, token1 } = await fetchPoolTokens(accessToken, poolAddress);

  const txs = [];
  if (BigInt(amount0Max) > 0n) txs.push(approvalTx(token0, poolAddress, amount0Max));
  if (BigInt(amount1Max) > 0n) txs.push(approvalTx(token1, poolAddress, amount1Max));
  txs.push({
    contractName: "PoolV3",
    contractAddress: poolAddress,
    method: "mint",
    args: {
      recipient: userAddress,
      tickLower,
      tickUpper,
      amount: liquidity,
      amount0Max,
      amount1Max,
      deadline: deadline(),
    },
  });

  const tx = await buildFunctionTx(txs, userAddress, accessToken);
  return executeTransaction(accessToken, tx);
};

const MAX_COLLECT = (2n ** 128n).toString();

export const burn = async (
  accessToken: string,
  params: PoolV3BurnParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, tickLower, tickUpper, liquidity, collect } = params;

  const txs: any[] = [
    {
      contractName: "PoolV3",
      contractAddress: poolAddress,
      method: "burn",
      args: { tickLower, tickUpper, amount: liquidity, deadline: deadline() },
    },
  ];
  if (collect) {
    txs.push({
      contractName: "PoolV3",
      contractAddress: poolAddress,
      method: "collect",
      args: {
        recipient: userAddress,
        tickLower,
        tickUpper,
        amount0Requested: MAX_COLLECT,
        amount1Requested: MAX_COLLECT,
      },
    });
  }

  const tx = await buildFunctionTx(txs, userAddress, accessToken);
  return executeTransaction(accessToken, tx);
};

/** True when the owner's position currently holds liquidity (poke-able). */
const positionHasLiquidity = async (
  accessToken: string,
  poolAddress: string,
  owner: string,
  tickLower: number,
  tickUpper: number
): Promise<boolean> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${PoolV3Positions}`, {
      params: {
        address: `eq.${normalizeAddress(poolAddress)}`,
        key: `eq.${normalizeAddress(owner)}`,
        key2: `eq.${tickLower}`,
        key3: `eq.${tickUpper}`,
        select: "liquidity:value->>liquidity",
      },
    });
    return BigInt(data?.[0]?.liquidity ?? "0") > 0n;
  } catch {
    return false;
  }
};

export const collect = async (
  accessToken: string,
  params: PoolV3CollectParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, tickLower, tickUpper, amount0Requested, amount1Requested } = params;

  // fees accrue to tokensOwed only when the position is touched; poke (burn 0)
  // before collecting so pending fees are realized — canonical periphery behavior.
  // A poke on a zero-liquidity position would revert 'NP', so gate on liquidity.
  const txs: any[] = [];
  if (await positionHasLiquidity(accessToken, poolAddress, userAddress, tickLower, tickUpper)) {
    txs.push({
      contractName: "PoolV3",
      contractAddress: poolAddress,
      method: "burn",
      args: { tickLower, tickUpper, amount: "0", deadline: deadline() },
    });
  }

  txs.push({
    contractName: "PoolV3",
    contractAddress: poolAddress,
    method: "collect",
    args: {
      recipient: userAddress,
      tickLower,
      tickUpper,
      amount0Requested: amount0Requested ?? MAX_COLLECT,
      amount1Requested: amount1Requested ?? MAX_COLLECT,
    },
  });

  const tx = await buildFunctionTx(txs, userAddress, accessToken);
  return executeTransaction(accessToken, tx);
};

/** Admin: create a pool via the factory (owner is AdminRegistry — may surface a governance vote) */
/** Resolve each token's decimals from the Token table (defaults to 18 if unset). */
const fetchTokenDecimals = async (
  accessToken: string,
  addresses: string[]
): Promise<Map<string, number>> => {
  const addrs = addresses.map(normalizeAddress);
  const { data } = await cirrus.get(accessToken, `/BlockApps-Token`, {
    params: { address: `in.(${addrs.join(",")})`, select: "address,customDecimals" },
  });
  const map = new Map<string, number>();
  for (const row of (data as { address: string; customDecimals: number | null }[]) ?? []) {
    map.set(row.address, row.customDecimals ?? 18);
  }
  return map;
};

export const createPool = async (
  accessToken: string,
  params: PoolV3CreateParams,
  userAddress: string
): Promise<TransactionResponse> => {
  if (!config.poolV3Factory) throw new Error("POOL_V3_FACTORY is not configured");

  // Accept either an explicit Q64.96 sqrt price or a human-readable price (converted here
  // using each token's decimals). The pool orders tokens as passed: tokenA=token0,
  // tokenB=token1, so `price` is token1-per-token0 (tokenB per tokenA).
  let initialSqrtPriceX96 = params.initialSqrtPriceX96;
  if (!initialSqrtPriceX96) {
    if (!params.price) throw new Error("Either price or initialSqrtPriceX96 is required");
    const decimals = await fetchTokenDecimals(accessToken, [params.tokenA, params.tokenB]);
    const dec0 = decimals.get(normalizeAddress(params.tokenA));
    const dec1 = decimals.get(normalizeAddress(params.tokenB));
    if (dec0 === undefined || dec1 === undefined) {
      throw new Error("Could not resolve token decimals — are both tokens indexed?");
    }
    initialSqrtPriceX96 = v3.priceToSqrtPriceX96(params.price, dec0, dec1).toString();
  }

  const tx = await buildFunctionTx(
    [
      {
        contractName: "PoolV3Factory",
        contractAddress: config.poolV3Factory,
        method: "createPoolV3",
        args: {
          tokenA: normalizeAddress(params.tokenA),
          tokenB: normalizeAddress(params.tokenB),
          fee: params.fee,
          initialSqrtPriceX96,
        },
      },
    ],
    userAddress,
    accessToken
  );
  return executeTransaction(accessToken, tx);
};
