// End-to-end check of the apply step against a real Postgres: partitions,
// idempotent replay, and order independence between the two feeds. Needs
// postgres_host/postgres_password etc. in the environment.
import assert from "assert";
import { bootstrapDb } from "../src/db/bootstrap";
import { pool, query } from "../src/db/pool";
import { applyEvents } from "../src/indexer/apply";
import { NormalizedEvent } from "../src/indexer/normalize";

const token = "aa".repeat(20);
const oracle = "bb".repeat(20);
const asset = "cc".repeat(20);
const poolAddr = "dd".repeat(20);
const alice = "11".repeat(20);
const bob = "22".repeat(20);

const ev = (name: string, blockNumber: number, ts: string, eventIndex: number, address: string, args: Record<string, unknown>): NormalizedEvent => ({
  source: "bus", contractName: "", address, name, blockNumber, blockTs: new Date(ts), eventIndex, txHash: null, sender: null, args,
});

const events: NormalizedEvent[] = [
  ev("Transfer", 100, "2026-09-01T10:00:00Z", 0, token, { from: "00".repeat(20), to: alice, value: "1000" }),
  ev("Transfer", 200, "2026-09-02T10:00:00Z", 0, token, { from: alice, to: bob, value: "300" }),
  ev("Transfer", 300, "2026-10-05T10:00:00Z", 0, token, { sender: alice, receiver: bob, value: "100" }), // StablePool spelling, next month
  ev("PriceUpdated", 100, "2026-09-01T10:00:30Z", 1, oracle, { asset, price: "2000000000000000000", timestamp: "1" }),
  ev("PriceUpdated", 101, "2026-09-01T10:00:45Z", 0, oracle, { asset, price: "3000000000000000000", timestamp: "2" }),
  ev("BatchPricesUpdated", 102, "2026-09-01T10:02:00Z", 0, oracle, { assets: [asset, "ee".repeat(20)], priceValues: ["1000000000000000000", "5"], timestamp: "3" }),
  ev("Swap", 150, "2026-09-01T12:00:00Z", 2, poolAddr, { sender: alice, tokenIn: token, tokenOut: asset, amountIn: "1000", amountOut: "2500" }),
  ev("Swap", 150, "2026-09-01T12:00:00Z", 3, poolAddr, { sender: bob, recipient: alice, amount0: "1", amount1: "-2", sqrtPriceX96: "7" }), // v3 shape, ignored
];

const snapshot = async () => ({
  current: (await query("SELECT account, balance::text FROM balances_current ORDER BY account")).rows,
  daily: (await query("SELECT account, day::text, balance::text FROM balance_snapshots_daily ORDER BY account, day")).rows,
  candles: (await query("SELECT series, resolution, bucket, open::text, high::text, low::text, close::text, volume::text, count FROM ohlc ORDER BY series, resolution, bucket")).rows,
  prices: Number((await query("SELECT count(*) FROM price_observations")).rows[0].count),
  swaps: Number((await query("SELECT count(*) FROM swaps")).rows[0].count),
});

(async () => {
  await bootstrapDb();
  await query("TRUNCATE balance_changes, balances_current, balance_snapshots_daily, price_observations, swaps, ohlc, history_progress");

  // Chain order first
  const s1 = await applyEvents(events, { name: "bus", blockNumber: 300, cursor: 1 });
  assert.strictEqual(s1.transfers, 3);
  assert.strictEqual(s1.prices, 4);
  assert.strictEqual(s1.swaps, 1);
  assert.strictEqual(s1.ignored, 1);
  const first = await snapshot();
  assert.strictEqual(first.prices, 4);
  assert.strictEqual(first.swaps, 1);
  assert.deepStrictEqual(first.current.map((r) => [r.account, r.balance]), [
    ["00".repeat(20), "-1000"], [alice, "600"], [bob, "400"],
  ]);
  const aliceDays = first.daily.filter((r) => r.account === alice).map((r) => [r.day, r.balance]);
  assert.deepStrictEqual(aliceDays, [["2026-09-01", "1000"], ["2026-09-02", "700"], ["2026-10-05", "600"]]);
  const oracle1m = first.candles.filter((r) => r.series === `oracle:${asset}` && r.resolution === "1m");
  assert.strictEqual(oracle1m.length, 2, "two one-minute candles");
  assert.strictEqual(oracle1m[0].open, "2000000000000000000.000000000000000000");
  assert.strictEqual(oracle1m[0].close, "3000000000000000000.000000000000000000");
  assert.strictEqual(oracle1m[0].count, 2);
  const oracle1d = first.candles.find((r) => r.series === `oracle:${asset}` && r.resolution === "1d")!;
  assert.strictEqual(oracle1d.high, "3000000000000000000.000000000000000000");
  assert.strictEqual(oracle1d.low, "1000000000000000000.000000000000000000");
  assert.strictEqual(oracle1d.close, "1000000000000000000.000000000000000000");
  const swap1h = first.candles.find((r) => r.series.startsWith("pool:") && r.resolution === "1h")!;
  assert.strictEqual(swap1h.open, "2.500000000000000000");
  assert.strictEqual(swap1h.volume, "1000");

  // Replay everything: nothing changes
  const s2 = await applyEvents(events);
  assert.strictEqual(s2.transfers + s2.prices + s2.swaps, 0);
  assert.strictEqual(s2.duplicates, 7);
  assert.deepStrictEqual(await snapshot(), first);

  // Reverse arrival order from empty: same result
  await query("TRUNCATE balance_changes, balances_current, balance_snapshots_daily, price_observations, swaps, ohlc, history_progress");
  for (const e of [...events].reverse()) await applyEvents([e]);
  assert.deepStrictEqual(await snapshot(), first);

  const partitions = (await query("SELECT inhrelid::regclass::text AS p FROM pg_inherits ORDER BY 1")).rows.map((r) => r.p);
  assert(partitions.includes("balance_changes_y2026m09") && partitions.includes("balance_changes_y2026m10"), "month partitions created");

  console.log("db.test: ok", { partitions: partitions.length });
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
