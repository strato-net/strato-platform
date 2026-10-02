import { PoolClient } from "pg";
import { withTransaction } from "../db/pool";
import { ensurePartitions } from "../db/partitions";
import { ratio18, toAddress, toBigInt } from "../utils/num";
import { NormalizedEvent, ord } from "./normalize";
import { advanceProgress } from "./progress";

export interface ApplyStats {
  events: number;
  transfers: number;
  prices: number;
  swaps: number;
  duplicates: number;
  ignored: number;
  malformed: number;
}

const RESOLUTIONS: [string, string][] = [
  ["1m", "minute"],
  ["1h", "hour"],
  ["1d", "day"],
];

const dayOf = (ts: Date): string => ts.toISOString().slice(0, 10);

/**
 * Both feeds call this; one batch at a time per process (see applySerialized)
 * so partition creation never races. Every write is keyed by chain position,
 * inserted with ON CONFLICT DO NOTHING, and the derived tables (current
 * balances, daily snapshots, candles) are only advanced by rows that were
 * actually new. The bus feed and the Cirrus poller can therefore overlap
 * and arrive in any order without coordinating.
 */
export const applyEvents = async (
  events: NormalizedEvent[],
  progress?: { name: string; blockNumber: number; cursor: number }
): Promise<ApplyStats> => {
  const stats: ApplyStats = { events: events.length, transfers: 0, prices: 0, swaps: 0, duplicates: 0, ignored: 0, malformed: 0 };
  if (events.length === 0 && !progress) return stats;
  await withTransaction(async (client) => {
    await ensurePartitions(client, events.map((e) => e.blockTs));
    // (token, account) -> earliest day touched, for the snapshot refresh
    const touched = new Map<string, { token: string; account: string; day: string }>();
    for (const e of events) await applyOne(client, e, stats, touched);
    for (const t of touched.values()) await refreshDailySnapshots(client, t.token, t.account, t.day);
    if (progress) await advanceProgress(client, progress.name, progress.blockNumber, progress.cursor);
  });
  return stats;
};

let chain: Promise<unknown> = Promise.resolve();

/** applyEvents, one batch at a time across the two feeds. */
export const applySerialized = (
  events: NormalizedEvent[],
  progress?: { name: string; blockNumber: number; cursor: number }
): Promise<ApplyStats> => {
  const run = () => applyEvents(events, progress);
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
};

const applyOne = async (
  client: PoolClient,
  e: NormalizedEvent,
  stats: ApplyStats,
  touched: Map<string, { token: string; account: string; day: string }>
): Promise<void> => {
  switch (e.name) {
    case "Transfer":
      return applyTransfer(client, e, stats, touched);
    case "PriceUpdated":
      return applyPrices(client, e, stats, [[e.args.asset, e.args.price]]);
    case "BatchPricesUpdated": {
      const assets = Array.isArray(e.args.assets) ? e.args.assets : null;
      const prices = Array.isArray(e.args.priceValues) ? e.args.priceValues : null;
      if (!assets || !prices || assets.length !== prices.length) {
        stats.malformed++;
        return;
      }
      return applyPrices(client, e, stats, assets.map((a, i) => [a, prices[i]]));
    }
    case "Swap":
      return applySwap(client, e, stats);
    default:
      stats.ignored++;
  }
};

// ERC20 Transfer(from, to, value); StablePool's LP token spells it
// Transfer(sender, receiver, value) and some mints use amount.
const applyTransfer = async (
  client: PoolClient,
  e: NormalizedEvent,
  stats: ApplyStats,
  touched: Map<string, { token: string; account: string; day: string }>
): Promise<void> => {
  const from = toAddress(e.args.from ?? e.args.sender);
  const to = toAddress(e.args.to ?? e.args.receiver);
  const value = toBigInt(e.args.value ?? e.args.amount);
  if (!from || !to || value === null) {
    stats.malformed++;
    return;
  }
  const legs: [string, bigint, number][] = [
    [from, -value, 0],
    [to, value, 1],
  ];
  let fresh = false;
  for (const [account, delta, leg] of legs) {
    const r = await client.query(
      `INSERT INTO balance_changes (token, account, block_number, block_ts, ord, leg, tx_hash, delta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
      [e.address, account, e.blockNumber, e.blockTs, ord(e.blockNumber, e.eventIndex), leg, e.txHash, delta.toString()]
    );
    if (r.rowCount !== 1) continue;
    fresh = true;
    await client.query(
      `INSERT INTO balances_current (token, account, balance) VALUES ($1, $2, $3)
       ON CONFLICT (token, account) DO UPDATE SET balance = balances_current.balance + EXCLUDED.balance`,
      [e.address, account, delta.toString()]
    );
    const key = `${e.address}:${account}`;
    const day = dayOf(e.blockTs);
    const prev = touched.get(key);
    if (!prev || day < prev.day) touched.set(key, { token: e.address, account, day });
  }
  if (fresh) stats.transfers++;
  else stats.duplicates++;
};

/**
 * Recompute the end-of-day balances of one account from `fromDay` on: the
 * running sum of its change log, seeded with everything before that day.
 * Only days with a change get a row; the API carries values forward.
 */
const refreshDailySnapshots = async (client: PoolClient, token: string, account: string, fromDay: string): Promise<void> => {
  await client.query(
    `INSERT INTO balance_snapshots_daily (token, account, day, balance)
     SELECT $1, $2, d.day,
            SUM(d.day_delta) OVER (ORDER BY d.day)
              + (SELECT COALESCE(SUM(delta), 0) FROM balance_changes
                  WHERE token = $1 AND account = $2 AND block_ts < $3::date)
     FROM (SELECT (block_ts AT TIME ZONE 'UTC')::date AS day, SUM(delta) AS day_delta
             FROM balance_changes
            WHERE token = $1 AND account = $2 AND block_ts >= $3::date
            GROUP BY 1) d
     ON CONFLICT (token, account, day) DO UPDATE SET balance = EXCLUDED.balance`,
    [token, account, fromDay]
  );
};

const applyPrices = async (
  client: PoolClient,
  e: NormalizedEvent,
  stats: ApplyStats,
  pairs: [unknown, unknown][]
): Promise<void> => {
  let fresh = 0;
  pairs.forEach(() => undefined);
  for (let i = 0; i < pairs.length; i++) {
    const asset = toAddress(pairs[i][0]);
    const price = toBigInt(pairs[i][1]);
    if (!asset || price === null) {
      stats.malformed++;
      continue;
    }
    const o = ord(e.blockNumber, e.eventIndex, i);
    const r = await client.query(
      `INSERT INTO price_observations (oracle, asset, block_number, block_ts, ord, tx_hash, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [e.address, asset, e.blockNumber, e.blockTs, o, e.txHash, price.toString()]
    );
    if (r.rowCount !== 1) continue;
    fresh++;
    await upsertCandles(client, `oracle:${asset}`, e.blockTs, o, price.toString(), "0");
  }
  if (fresh > 0) stats.prices += fresh;
  else stats.duplicates++;
};

// Pool / StablePool Swap(sender, tokenIn, tokenOut, amountIn, amountOut).
// PoolV3's Swap(sender, recipient, amount0, amount1, sqrtPriceX96, ...) has a
// different shape and is left for a follow-up: it is counted as ignored.
const applySwap = async (client: PoolClient, e: NormalizedEvent, stats: ApplyStats): Promise<void> => {
  const tokenIn = toAddress(e.args.tokenIn);
  const tokenOut = toAddress(e.args.tokenOut);
  const amountIn = toBigInt(e.args.amountIn);
  const amountOut = toBigInt(e.args.amountOut);
  if (!tokenIn || !tokenOut || amountIn === null || amountOut === null) {
    if (e.args.sqrtPriceX96 !== undefined) stats.ignored++;
    else stats.malformed++;
    return;
  }
  const o = ord(e.blockNumber, e.eventIndex);
  const r = await client.query(
    `INSERT INTO swaps (pool, block_number, block_ts, ord, tx_hash, sender, token_in, token_out, amount_in, amount_out)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
    [e.address, e.blockNumber, e.blockTs, o, e.txHash, toAddress(e.args.sender), tokenIn, tokenOut, amountIn.toString(), amountOut.toString()]
  );
  if (r.rowCount !== 1) {
    stats.duplicates++;
    return;
  }
  stats.swaps++;
  const price = ratio18(amountOut, amountIn);
  if (price) await upsertCandles(client, `pool:${e.address}:${tokenIn}:${tokenOut}`, e.blockTs, o, price, amountIn.toString());
};

/** Fold one observation into its 1m, 1h and 1d candles, order independent. */
const upsertCandles = async (
  client: PoolClient,
  series: string,
  ts: Date,
  o: string,
  price: string,
  volume: string
): Promise<void> => {
  for (const [resolution, unit] of RESOLUTIONS) {
    await client.query(
      `INSERT INTO ohlc (series, resolution, bucket, open, high, low, close, volume, count, first_ord, last_ord)
       VALUES ($1, $2, date_trunc($3, $4::timestamptz), $5, $5, $5, $5, $6, 1, $7, $7)
       ON CONFLICT (series, resolution, bucket) DO UPDATE SET
         open = CASE WHEN EXCLUDED.first_ord < ohlc.first_ord THEN EXCLUDED.open ELSE ohlc.open END,
         first_ord = LEAST(ohlc.first_ord, EXCLUDED.first_ord),
         close = CASE WHEN EXCLUDED.last_ord > ohlc.last_ord THEN EXCLUDED.close ELSE ohlc.close END,
         last_ord = GREATEST(ohlc.last_ord, EXCLUDED.last_ord),
         high = GREATEST(ohlc.high, EXCLUDED.high),
         low = LEAST(ohlc.low, EXCLUDED.low),
         volume = ohlc.volume + EXCLUDED.volume,
         count = ohlc.count + 1`,
      [series, resolution, unit, ts, price, volume, o]
    );
  }
};
