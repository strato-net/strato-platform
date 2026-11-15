import axios from "axios";
import { config } from "../config";
import { query, withTransaction } from "../db/pool";
import { parseJsonPreservingBigInts, toAddress } from "../utils/num";
import { logError, logInfo } from "../utils/logger";
import { Activity, activityOf, ChainEvent, learn, State } from "./activity";

const EVENT_NAMES = [
  "PriceUpdated", "BatchPricesUpdated", "NewPool", "NewPoolV3",
  "Swap", "MetalMinted", "DepositCompleted", "Deposited", "SuppliedCollateral",
];
const SELECT = "id,address,block_timestamp,transaction_sender,event_name,attributes";

// How long the activity of an account nobody referred is kept. A signup can
// reach this service after the account's first events were read (the backend
// retries a failed call, an operator replays one from its log); inside this
// period those events are still there to be counted.
const GRACE_DAYS = 7;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

interface CirrusEventRow {
  id: number | string;
  address: string;
  block_timestamp: string;
  transaction_sender: string;
  event_name: string;
  attributes: Record<string, unknown> | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Cirrus renders block_timestamp as text, e.g. "2026-09-04 12:00:00 UTC" or
// ISO 8601; both are read.
const parseCirrusTimestamp = (s: string): Date => {
  const direct = new Date(s);
  if (!Number.isNaN(direct.getTime())) return direct;
  return new Date(`${s.trim().replace(/ UTC$/, "").replace(" ", "T")}Z`);
};

export const fromCirrusRow = (row: CirrusEventRow): ChainEvent | null => {
  const address = toAddress(row.address);
  const blockTs = parseCirrusTimestamp(String(row.block_timestamp));
  if (!address || Number.isNaN(blockTs.getTime())) return null;
  return {
    id: Number(row.id),
    address,
    name: String(row.event_name || ""),
    blockTs,
    txSender: toAddress(row.transaction_sender),
    args: row.attributes || {},
  };
};

/**
 * Reads from Cirrus the decimals of the priced assets state does not have
 * them for. A token's decimals are set once, at its creation, so each asset
 * is looked up once per run; one without a token record gets null.
 */
export const learnDecimals = async (state: State, assets: Iterable<string>): Promise<void> => {
  const unknown = [...assets].filter((a) => !state.decimals.has(a));
  for (let i = 0; i < unknown.length; i += 100) {
    const batch = unknown.slice(i, i + 100);
    const { data } = await axios.get<{ address: string; customDecimals: unknown }[]>(`${config.cirrus.nodeUrl}/cirrus/search/BlockApps-Token`, {
      params: { select: "address,customDecimals", address: `in.(${batch.join(",")})` },
      timeout: 60000,
    });
    if (!Array.isArray(data)) throw new Error("Cirrus returned no token list");
    batch.forEach((a) => state.decimals.set(a, null));
    for (const token of data) {
      const address = toAddress(token.address);
      // A record with no decimals on it is not a zero-decimal token: it stays null
      const decimals = token.customDecimals == null ? NaN : Number(token.customDecimals);
      if (address && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36) state.decimals.set(address, decimals);
    }
  }
};

// The position is read before the state that has to match it: if another
// instance commits in between, this one's next commit finds the position
// moved and fails, rather than pairing newer prices with an older position.
const loadPosition = async (): Promise<{ cursor: number; state: State }> => {
  const cursor = Number((await query<{ cursor: string }>("SELECT cursor FROM progress WHERE name = 'cirrus'")).rows[0]?.cursor ?? 0);
  const [prices, pools] = await Promise.all([
    query<{ asset: string; price: string }>("SELECT asset, price::text FROM prices"),
    query<{ address: string; token0: string; token1: string }>("SELECT address, token0, token1 FROM pools"),
  ]);
  const state: State = {
    prices: new Map(prices.rows.map((r) => [r.asset, BigInt(r.price)])),
    decimals: new Map(),
    pools: new Map(pools.rows.map((r) => [r.address, [r.token0, r.token1]])),
    dirtyPrices: new Set(),
    dirtyPools: new Set(),
  };
  await learnDecimals(state, state.prices.keys());
  return { cursor, state };
};

/**
 * One transaction per page: the poller's move from one position to the
 * next, the state the page changed, and its activity (of referred accounts,
 * and of anyone inside the grace period). The move comes first and only
 * succeeds from the position the page was read at, so two instances polling
 * at once (a deployment replacing a task) cannot commit over each other.
 */
export const commit = async (state: State, activities: Activity[], from: number, cursor: number, asOf: Date): Promise<void> => {
  await withTransaction(async (client) => {
    const moved = await client.query(
      `INSERT INTO progress (name, cursor, as_of) VALUES ('cirrus', $2, $3)
       ON CONFLICT (name) DO UPDATE SET cursor = EXCLUDED.cursor, as_of = EXCLUDED.as_of
       WHERE progress.cursor = $1`,
      [from, cursor, asOf]
    );
    if (moved.rowCount !== 1) throw new Error(`Position is no longer ${from}: another instance is polling`);
    const assets = [...state.dirtyPrices];
    if (assets.length) {
      await client.query(
        `INSERT INTO prices (asset, price) SELECT * FROM unnest($1::text[], $2::numeric[])
         ON CONFLICT (asset) DO UPDATE SET price = EXCLUDED.price`,
        [assets, assets.map((a) => state.prices.get(a)!.toString())]
      );
    }
    const pools = [...state.dirtyPools];
    if (pools.length) {
      await client.query(
        `INSERT INTO pools (address, token0, token1) SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
         ON CONFLICT (address) DO NOTHING`,
        [pools, pools.map((p) => state.pools.get(p)![0]), pools.map((p) => state.pools.get(p)![1])]
      );
    }
    if (activities.length) {
      await client.query(
        `INSERT INTO activity (event_id, account, block_ts, usd_wad)
         SELECT v.event_id, v.account, v.block_ts, v.usd_wad
         FROM unnest($1::bigint[], $2::text[], $3::timestamptz[], $4::numeric[]) AS v(event_id, account, block_ts, usd_wad)
         WHERE v.block_ts > now() - make_interval(days => $5)
            OR EXISTS (SELECT 1 FROM referrals r WHERE r.account = v.account)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          activities.map((a) => a.eventId),
          activities.map((a) => a.account),
          activities.map((a) => a.blockTs),
          activities.map((a) => a.usdWad.toString()),
          GRACE_DAYS,
        ]
      );
    }
  });
  state.dirtyPrices.clear();
  state.dirtyPools.clear();
};

/** Drops the activity the grace period kept for accounts nobody referred in time. */
export const prune = async (): Promise<void> => {
  await query(
    `DELETE FROM activity a
     WHERE a.block_ts <= now() - make_interval(days => $1)
       AND NOT EXISTS (SELECT 1 FROM referrals r WHERE r.account = a.account)`,
    [GRACE_DAYS]
  );
};

/**
 * Pages Cirrus's global event table by id from the stored position until
 * something fails: from genesis on first start (which builds prices and
 * pools; events older than the grace period are only kept for referred
 * accounts), afterwards one page per poll interval. Rows arrive in chain
 * order, so the price in state when an event is read is the price at its
 * execution. Anonymous reads: no Authorization header.
 */
const pollFromStoredPosition = async (): Promise<never> => {
  const { cirrus } = config;
  const position = await loadPosition();
  const { state } = position;
  let { cursor } = position;
  let prunedAt = 0;
  logInfo("Cirrus", `Polling ${cirrus.nodeUrl}/cirrus/search/event from id ${cursor}`);
  for (;;) {
    const { data } = await axios.get<CirrusEventRow[]>(`${cirrus.nodeUrl}/cirrus/search/event`, {
      params: {
        select: SELECT,
        id: `gt.${cursor}`,
        order: "id.asc",
        limit: cirrus.pageSize,
        event_name: `in.(${EVENT_NAMES.join(",")})`,
      },
      transformResponse: [(text: string) => (typeof text === "string" ? parseJsonPreservingBigInts(text) : text)],
      timeout: 60000,
    });
    const rows = Array.isArray(data) ? data : [];
    const caughtUp = rows.length < cirrus.pageSize;
    const activities: Activity[] = [];
    for (const row of rows) {
      const e = fromCirrusRow(row);
      if (!e) continue;
      learn(e, state);
      await learnDecimals(state, state.dirtyPrices);
      const activity = activityOf(e, state);
      if (activity) activities.push(activity);
    }
    const last = rows[rows.length - 1];
    const next = last ? Number(last.id) : cursor;
    await commit(state, activities, cursor, next, caughtUp ? new Date() : parseCirrusTimestamp(String(last.block_timestamp)));
    cursor = next;
    if (rows.length) logInfo("Cirrus", `read ${rows.length} rows through id ${cursor}`, { candidates: activities.length });
    if (caughtUp) {
      if (Date.now() - prunedAt > PRUNE_INTERVAL_MS) {
        await prune();
        prunedAt = Date.now();
      }
      await sleep(cirrus.intervalMs);
    }
  }
};

/**
 * Runs the poller for good. After any failure it starts over from the stored
 * position, reloading prices and pools with it: a page that was learned but
 * not committed never values the pages read after it.
 */
export const runCirrusPoller = async (): Promise<void> => {
  for (;;) {
    try {
      await pollFromStoredPosition();
    } catch (error) {
      logError("Cirrus", error, { retryInMs: config.cirrus.intervalMs });
      await sleep(config.cirrus.intervalMs);
    }
  }
};
