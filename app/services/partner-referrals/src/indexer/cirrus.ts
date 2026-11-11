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

const loadState = async (): Promise<State> => {
  const [prices, pools] = await Promise.all([
    query<{ asset: string; price: string }>("SELECT asset, price::text FROM prices"),
    query<{ address: string; token0: string; token1: string }>("SELECT address, token0, token1 FROM pools"),
  ]);
  return {
    prices: new Map(prices.rows.map((r) => [r.asset, BigInt(r.price)])),
    pools: new Map(pools.rows.map((r) => [r.address, [r.token0, r.token1]])),
    dirtyPrices: new Set(),
    dirtyPools: new Set(),
  };
};

/**
 * One transaction per page: the state the page changed, the activity of
 * accounts that were referred (everyone else's is dropped by the join), and
 * the poller's new position.
 */
export const commit = async (state: State, activities: Activity[], cursor: number, asOf: Date): Promise<void> => {
  await withTransaction(async (client) => {
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
         JOIN referrals r ON r.account = v.account
         ON CONFLICT (event_id) DO NOTHING`,
        [
          activities.map((a) => a.eventId),
          activities.map((a) => a.account),
          activities.map((a) => a.blockTs),
          activities.map((a) => a.usdWad.toString()),
        ]
      );
    }
    await client.query(
      `INSERT INTO progress (name, cursor, as_of) VALUES ('cirrus', $1, $2)
       ON CONFLICT (name) DO UPDATE SET cursor = EXCLUDED.cursor, as_of = EXCLUDED.as_of`,
      [cursor, asOf]
    );
  });
  state.dirtyPrices.clear();
  state.dirtyPools.clear();
};

/**
 * Pages Cirrus's global event table by id from where it last stopped: from
 * genesis on first start (which only builds prices and pools, nobody is
 * referred yet), afterwards one page per poll interval. Rows arrive in chain
 * order, so the price in state when an event is read is the price at its
 * execution. Anonymous reads: no Authorization header.
 */
export const runCirrusPoller = async (): Promise<void> => {
  const { cirrus } = config;
  let state = await loadState();
  let cursor = Number((await query<{ cursor: string }>("SELECT cursor FROM progress WHERE name = 'cirrus'")).rows[0]?.cursor ?? 0);
  logInfo("Cirrus", `Polling ${cirrus.nodeUrl}/cirrus/search/event from id ${cursor}`);
  for (;;) {
    try {
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
        const activity = activityOf(e, state);
        if (activity) activities.push(activity);
      }
      const last = rows[rows.length - 1];
      const next = last ? Number(last.id) : cursor;
      await commit(state, activities, next, caughtUp ? new Date() : parseCirrusTimestamp(String(last.block_timestamp)));
      cursor = next;
      if (rows.length) logInfo("Cirrus", `read ${rows.length} rows through id ${cursor}`, { candidates: activities.length });
      if (caughtUp) await sleep(cirrus.intervalMs);
    } catch (error) {
      logError("Cirrus", error, { cursor, retryInMs: cirrus.intervalMs });
      await sleep(cirrus.intervalMs);
      // The failed page may have moved prices ahead of the stored position.
      state = await loadState().catch(() => state);
    }
  }
};
