import express from "express";
import { config } from "../config";
import { query } from "../db/pool";
import { allProgress } from "../indexer/progress";
import { toAddress } from "../utils/num";

const RESOLUTIONS = new Set(["1m", "1h", "1d"]);
const BUCKET_SECONDS: Record<string, number> = { "1m": 60, "1h": 3600, "1d": 86400 };

class BadRequest extends Error {}

const asyncHandler =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) =>
    fn(req, res).catch((error) => {
      if (error instanceof BadRequest) res.status(400).json({ error: error.message });
      else next(error);
    });

const address = (v: unknown, what: string): string => {
  const a = toAddress(v);
  if (!a) throw new BadRequest(`${what} must be a 20-byte hex address`);
  return a;
};

const resolution = (v: unknown): string => {
  const r = typeof v === "string" && v ? v : "1h";
  if (!RESOLUTIONS.has(r)) throw new BadRequest("resolution must be 1m, 1h or 1d");
  return r;
};

/** ISO 8601 or epoch seconds; `fallback` when absent. */
const time = (v: unknown, fallback: Date): Date => {
  if (v === undefined || v === "") return fallback;
  const s = String(v);
  const d = /^\d+$/.test(s) ? new Date(Number(s) * 1000) : new Date(s);
  if (Number.isNaN(d.getTime())) throw new BadRequest(`bad time ${s}`);
  return d;
};

const range = (q: express.Request["query"], res: string): { from: Date; to: Date } => {
  const to = time(q.to, new Date());
  const defaultSpan = BUCKET_SECONDS[res] * 500 * 1000;
  const from = time(q.from, new Date(to.getTime() - defaultSpan));
  if (from >= to) throw new BadRequest("from must be before to");
  const points = (to.getTime() - from.getTime()) / 1000 / BUCKET_SECONDS[res];
  if (points > config.api.maxPoints) {
    throw new BadRequest(`range spans ${Math.ceil(points)} ${res} buckets; the limit is ${config.api.maxPoints}, use a coarser resolution`);
  }
  return { from, to };
};

const cache = (res: express.Response, key: string) => {
  res.set("Cache-Control", `public, max-age=${config.api.maxAge[key] ?? 60}`);
};

const candles = async (series: string, res: string, from: Date, to: Date) => {
  const r = await query(
    `SELECT extract(epoch FROM bucket)::bigint AS t, open, high, low, close, volume, count
       FROM ohlc WHERE series = $1 AND resolution = $2 AND bucket >= $3 AND bucket < $4
      ORDER BY bucket`,
    [series, res, from, to]
  );
  // Compact rows: [t, open, high, low, close, volume, count]; numerics stay
  // strings so uint256 amounts survive the trip.
  return r.rows.map((row) => [Number(row.t), row.open, row.high, row.low, row.close, row.volume, Number(row.count)]);
};

export const router = express.Router();

router.get("/health", (_req, res) => {
  res.status(200).json({ status: true, message: "pong" });
});

router.get(
  "/status",
  asyncHandler(async (_req, res) => {
    const rows = await allProgress();
    res.set("Cache-Control", "no-store");
    res.json({
      feeds: Object.fromEntries(rows.map((r) => [r.name, { blockNumber: Number(r.block_number), cursor: Number(r.cursor), updatedAt: r.updated_at }])),
    });
  })
);

// Oracle price series for an asset: candles of PriceUpdated / BatchPricesUpdated
router.get(
  "/prices/:asset",
  asyncHandler(async (req, res) => {
    const asset = address(req.params.asset, "asset");
    const r = resolution(req.query.resolution);
    const { from, to } = range(req.query, r);
    const points = await candles(`oracle:${asset}`, r, from, to);
    cache(res, r);
    res.json({ series: `oracle:${asset}`, resolution: r, from: from.toISOString(), to: to.toISOString(), points });
  })
);

router.get(
  "/prices/:asset/latest",
  asyncHandler(async (req, res) => {
    const asset = address(req.params.asset, "asset");
    const r = await query(
      `SELECT oracle, price, block_number, block_ts FROM price_observations WHERE asset = $1 ORDER BY ord DESC LIMIT 1`,
      [asset]
    );
    cache(res, "latest");
    if (r.rowCount === 0) {
      res.status(404).json({ error: "no observations for this asset" });
      return;
    }
    const row = r.rows[0];
    res.json({ asset, oracle: row.oracle, price: row.price, blockNumber: Number(row.block_number), at: row.block_ts });
  })
);

// Pool price series: amountOut per amountIn for one direction, from Swap events
router.get(
  "/pools/:pool/ohlc",
  asyncHandler(async (req, res) => {
    const pool = address(req.params.pool, "pool");
    const tokenIn = address(req.query.tokenIn, "tokenIn");
    const tokenOut = address(req.query.tokenOut, "tokenOut");
    const r = resolution(req.query.resolution);
    const { from, to } = range(req.query, r);
    const series = `pool:${pool}:${tokenIn}:${tokenOut}`;
    const points = await candles(series, r, from, to);
    cache(res, r);
    res.json({ series, resolution: r, from: from.toISOString(), to: to.toISOString(), priceUnit: "amountOut per amountIn, raw units, 18 decimals", volumeUnit: "amountIn, raw units", points });
  })
);

router.get(
  "/pools/:pool/swaps",
  asyncHandler(async (req, res) => {
    const pool = address(req.params.pool, "pool");
    const to = time(req.query.to, new Date());
    const from = time(req.query.from, new Date(to.getTime() - 24 * 3600 * 1000));
    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
    const r = await query(
      `SELECT block_number, block_ts, tx_hash, sender, token_in, token_out, amount_in, amount_out
         FROM swaps WHERE pool = $1 AND block_ts >= $2 AND block_ts < $3 ORDER BY ord DESC LIMIT $4`,
      [pool, from, to, limit]
    );
    cache(res, "latest");
    res.json({ pool, swaps: r.rows });
  })
);

// Daily balance series for one account and token, carried forward over quiet days
router.get(
  "/balances/:account",
  asyncHandler(async (req, res) => {
    const account = address(req.params.account, "account");
    const token = address(req.query.token, "token");
    const to = time(req.query.to, new Date());
    const from = time(req.query.from, new Date(to.getTime() - 90 * 86400 * 1000));
    if (from >= to) throw new BadRequest("from must be before to");
    const days = Math.ceil((to.getTime() - from.getTime()) / 86400000);
    if (days > config.api.maxPoints) throw new BadRequest(`range spans ${days} days; the limit is ${config.api.maxPoints}`);
    const fromDay = from.toISOString().slice(0, 10);
    const toDay = to.toISOString().slice(0, 10);
    const [before, within] = await Promise.all([
      query(`SELECT balance FROM balance_snapshots_daily WHERE token = $1 AND account = $2 AND day < $3 ORDER BY day DESC LIMIT 1`, [token, account, fromDay]),
      query(`SELECT day::text AS day, balance FROM balance_snapshots_daily WHERE token = $1 AND account = $2 AND day >= $3 AND day <= $4 ORDER BY day`, [token, account, fromDay, toDay]),
    ]);
    const changes = new Map(within.rows.map((r) => [r.day, r.balance as string]));
    let balance: string = before.rows[0]?.balance ?? "0";
    const points: [string, string][] = [];
    for (let d = new Date(`${fromDay}T00:00:00Z`); d <= to; d = new Date(d.getTime() + 86400000)) {
      const day = d.toISOString().slice(0, 10);
      if (changes.has(day)) balance = changes.get(day)!;
      points.push([day, balance]);
    }
    cache(res, "1d");
    res.json({ account, token, points });
  })
);

router.get(
  "/balances/:account/current",
  asyncHandler(async (req, res) => {
    const account = address(req.params.account, "account");
    const token = req.query.token ? address(req.query.token, "token") : null;
    const r = token
      ? await query(`SELECT token, balance FROM balances_current WHERE account = $1 AND token = $2`, [account, token])
      : await query(`SELECT token, balance FROM balances_current WHERE account = $1 AND balance <> 0 ORDER BY token`, [account]);
    cache(res, "latest");
    res.json({ account, balances: r.rows });
  })
);
