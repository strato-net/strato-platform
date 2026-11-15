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
const SELECT = "id,address,block_hash,block_number,event_index,block_timestamp,transaction_sender,event_name,attributes";

// How long the activity of an account nobody referred is kept. A signup can
// reach this service after the account's first events were read (the backend
// retries a failed call, an operator replays one from its log); inside this
// period those events are still there to be counted.
const GRACE_DAYS = 7;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

interface CirrusEventRow {
  id: number | string;
  address: string;
  block_hash: string;
  block_number: number | string;
  event_index: number | string;
  block_timestamp: string;
  transaction_sender: string;
  event_name: string;
  attributes: Record<string, unknown> | null;
}

/**
 * Where the poller stands. Cirrus numbers its event rows per node database:
 * the row id pages fast, but is another event on another node (one switched
 * in behind a load balancer, or rebuilt). event is what that row is on the
 * chain, the same on every node; null before the first event is read.
 */
export interface Position {
  cursor: number;
  event: { address: string; blockHash: string; eventIndex: number; blockNumber: number } | null;
}

// Cirrus's own key of an event: the genesis block numbers each contract's events from 1, so the address is part of it
const matches = (row: Pick<CirrusEventRow, "address" | "block_hash" | "event_index">, event: NonNullable<Position["event"]>): boolean =>
  row.address === event.address && row.block_hash === event.blockHash && Number(row.event_index) === event.eventIndex;

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
  const eventIndex = Number(row.event_index);
  if (!address || !row.block_hash || !Number.isInteger(eventIndex) || Number.isNaN(blockTs.getTime())) return null;
  return {
    blockHash: String(row.block_hash),
    eventIndex,
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
const loadPosition = async (): Promise<Position & { state: State }> => {
  const at = (
    await query<{ cursor: string; address: string | null; block_hash: string | null; event_index: number | null; block_number: string | null }>(
      "SELECT cursor, address, block_hash, event_index, block_number FROM progress WHERE name = 'cirrus'"
    )
  ).rows[0];
  const cursor = Number(at?.cursor ?? 0);
  const event =
    at?.address && at.block_hash && at.event_index !== null
      ? { address: at.address, blockHash: at.block_hash, eventIndex: at.event_index, blockNumber: Number(at.block_number) }
      : null;
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
  return { cursor, event, state };
};

/**
 * One transaction per page: the poller's move from one position to the
 * next, the state the page changed, and its activity (of referred accounts,
 * and of anyone inside the grace period). The move comes first and only
 * succeeds from the position the page was read at, so two instances polling
 * at once (a deployment replacing a task) cannot commit over each other.
 */
export const commit = async (state: State, activities: Activity[], from: Position, to: Position, asOf: Date): Promise<void> => {
  // The event is compared along with the row id, which alone can be another event's on another node
  const key = (p: Position) => [p.event?.address ?? null, p.event?.blockHash ?? null, p.event?.eventIndex ?? null];
  await withTransaction(async (client) => {
    const moved = await client.query(
      `INSERT INTO progress (name, cursor, as_of, address, block_hash, event_index, block_number) VALUES ('cirrus', $2, $3, $4, $5, $6, $7)
       ON CONFLICT (name) DO UPDATE SET cursor = EXCLUDED.cursor, as_of = EXCLUDED.as_of, address = EXCLUDED.address,
         block_hash = EXCLUDED.block_hash, event_index = EXCLUDED.event_index, block_number = EXCLUDED.block_number
       WHERE progress.cursor = $1
         AND (progress.address, progress.block_hash, progress.event_index) IS NOT DISTINCT FROM ($8::text, $9::text, $10::int)`,
      [from.cursor, to.cursor, asOf, ...key(to), to.event?.blockNumber ?? null, ...key(from)]
    );
    if (moved.rowCount !== 1) throw new Error(`Position is no longer ${from.cursor}: another instance is polling`);
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
        `INSERT INTO activity (block_hash, event_index, account, block_ts, usd_wad)
         SELECT v.block_hash, v.event_index, v.account, v.block_ts, v.usd_wad
         FROM unnest($1::text[], $2::int[], $3::text[], $4::timestamptz[], $5::numeric[]) AS v(block_hash, event_index, account, block_ts, usd_wad)
         WHERE v.block_ts > now() - make_interval(days => $6)
            OR EXISTS (SELECT 1 FROM referrals r WHERE r.account = v.account)
         ON CONFLICT (block_hash, event_index) DO NOTHING`,
        [
          activities.map((a) => a.blockHash),
          activities.map((a) => a.eventIndex),
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
 * The id the position's event has on the node that answers now. A node that
 * has not reached the event's block yet is asked again later. One that is
 * past it without the event is on a chain that no longer has it (a
 * rollback): what was read from the chain is dropped, to be read again.
 */
const locate = async (event: NonNullable<Position["event"]>, stored: number): Promise<number> => {
  const url = `${config.cirrus.nodeUrl}/cirrus/search/event`;
  const select = "id,address,block_hash,block_number,event_index";
  type Row = Pick<CirrusEventRow, "id" | "address" | "block_hash" | "block_number" | "event_index">;
  const newest = await axios.get<Row[]>(url, { params: { select, order: "id.desc", limit: 1 }, timeout: 60000 });
  const top = Array.isArray(newest.data) ? newest.data[0] : undefined;
  if (!top) throw new Error(`The node has no events yet, behind the position's block ${event.blockNumber}`);
  // The position's event is asked for together with the newest one. Two nodes behind a load balancer can
  // answer in turn, one that lacks the event and one that is past its block: only an answer with the
  // newest event and without the position's is one node that is both
  const one = (address: string, blockHash: string, eventIndex: number | string) => `and(address.eq.${address},block_hash.eq.${blockHash},event_index.eq.${eventIndex})`;
  const found = await axios.get<Row[]>(url, {
    params: { select, or: `(${one(event.address, event.blockHash, event.eventIndex)},${one(top.address, top.block_hash, top.event_index)})` },
    timeout: 60000,
  });
  const rows = Array.isArray(found.data) ? found.data : [];
  const at = rows.find((row) => matches(row, event));
  if (at) return Number(at.id);
  if (!rows.length) throw new Error(`The newest event, of block ${top.block_number}, is on one node and not on the next`);
  const height = Number(top.block_number);
  if (height <= event.blockNumber) throw new Error(`The node is at block ${height}, behind the position's block ${event.blockNumber}`);
  await withTransaction(async (client) => {
    const reset = await client.query(
      `UPDATE progress SET cursor = 0, address = NULL, block_hash = NULL, event_index = NULL, block_number = NULL
       WHERE name = 'cirrus' AND cursor = $1 AND address = $2 AND block_hash = $3 AND event_index = $4`,
      [stored, event.address, event.blockHash, event.eventIndex]
    );
    if (reset.rowCount === 1) await client.query("TRUNCATE activity, prices, pools");
  });
  throw new Error(`The node is past block ${event.blockNumber} without the position's event: reading the chain again from the start`);
};

/**
 * Pages Cirrus's global event table by id from the stored position until
 * something fails: from genesis on first start (which builds prices and
 * pools; events older than the grace period are only kept for referred
 * accounts), afterwards one page per poll interval. Rows arrive in chain
 * order, so the price in state when an event is read is the price at its
 * execution. Anonymous reads: no Authorization header.
 */
export const pollFromStoredPosition = async (): Promise<never> => {
  const { cirrus } = config;
  const position = await loadPosition();
  const { state } = position;
  let { cursor, event } = position;
  // What progress holds, which a commit moves on from. cursor leaves it when the node numbers the event differently
  let stored: Position = { cursor, event };
  let prunedAt = 0;
  logInfo("Cirrus", `Polling ${cirrus.nodeUrl}/cirrus/search/event from id ${cursor}`);
  for (;;) {
    // A page starts at the position's own event: found there, the node still numbers it the same
    const { data } = await axios.get<CirrusEventRow[]>(`${cirrus.nodeUrl}/cirrus/search/event`, {
      params: {
        select: SELECT,
        id: `${event ? "gte" : "gt"}.${cursor}`,
        order: "id.asc",
        limit: cirrus.pageSize + (event ? 1 : 0),
        event_name: `in.(${EVENT_NAMES.join(",")})`,
      },
      transformResponse: [(text: string) => (typeof text === "string" ? parseJsonPreservingBigInts(text) : text)],
      timeout: 60000,
    });
    let rows = Array.isArray(data) ? data : [];
    if (event) {
      const first = rows[0];
      if (!first || !matches(first, event)) {
        const id = await locate(event, stored.cursor);
        // Found where the page was just read from: two nodes answer in turn, so wait for one
        if (id === cursor) throw new Error(`The position's event is ${id} on one node and not on the next`);
        logInfo("Cirrus", `The node numbers the position's event ${id}, not ${cursor}: continuing from there`);
        cursor = id;
        continue;
      }
      rows = rows.slice(1);
    }
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
    if (last) {
      cursor = Number(last.id);
      event = { address: last.address, blockHash: last.block_hash, eventIndex: Number(last.event_index), blockNumber: Number(last.block_number) };
    }
    await commit(state, activities, stored, { cursor, event }, caughtUp ? new Date() : parseCirrusTimestamp(String(last.block_timestamp)));
    stored = { cursor, event };
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
