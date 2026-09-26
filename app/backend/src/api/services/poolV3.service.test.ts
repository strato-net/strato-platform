import assert from "node:assert/strict";
import test from "node:test";
import { V3_POOL_APY_MIN_TVL_USD } from "../../config/poolV3Constants";
import {
  attributableInputs,
  buildPool,
  timeWeightedTvlUSD,
  PoolWindow,
  RawV3Pool,
  Swap24h,
  TvlSample,
} from "./poolV3.service";

const WAD = 10n ** 18n;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const TOKEN0 = "a".repeat(40);
const TOKEN1 = "b".repeat(40);
const POOL = "c".repeat(40);

// wstETH at $3,000 and USDST at $1
const prices = new Map<string, string>([
  [TOKEN0, (3000n * WAD).toString()],
  [TOKEN1, WAD.toString()],
]);

const token = (address: string, symbol: string) => ({
  address,
  _name: symbol,
  _symbol: symbol,
  customDecimals: null,
  status: "active",
});

/** 0.3% pool, no protocol cut, $30k + $30k = $60k TVL behind 1000 units of in-range liquidity */
const makeRaw = (overrides: Partial<RawV3Pool> = {}): RawV3Pool => ({
  address: POOL,
  fee: 3000,
  tickSpacing: 60,
  sqrtPriceX96: "1",
  currentTick: 0,
  liquidity: "1000",
  feeGrowthGlobal0X128: "0",
  feeGrowthGlobal1X128: "0",
  feeProtocol: 0,
  protocolFees0: "0",
  protocolFees1: "0",
  token0Balance: (10n * WAD).toString(),
  token1Balance: (30_000n * WAD).toString(),
  token0: token(TOKEN0, "wstETH"),
  token1: token(TOKEN1, "USDST"),
  isPaused: false,
  isDisabled: false,
  ...overrides,
});

/** a USDST-in swap of `usd` dollars executed while the pool had `liquidity` in range */
const swapIn1 = (usd: bigint, liquidity: bigint): Swap24h => ({ in0: 0n, in1: usd * WAD, liquidity });

// ten $10k swaps = $100k volume, all at the baseline liquidity → $300/day of LP fees
const swaps = Array.from({ length: 10 }, () => swapIn1(10_000n, 1000n));
const BASELINE_APY = (300 / 60_000) * 365 * 100; // 182.5%

const WINDOW_END = Date.parse("2026-09-21T20:00:00Z");
const WINDOW_START = WINDOW_END - DAY_MS;

/** balances held from `fromMs` until `toMs`; by default from before the window until now */
const sample = (
  eth: bigint,
  usdst: bigint,
  fromMs = WINDOW_START - HOUR_MS,
  toMs = Number.POSITIVE_INFINITY,
): TvlSample => ({
  fromMs,
  toMs,
  token0Balance: (eth * WAD).toString(),
  token1Balance: (usdst * WAD).toString(),
});

/** the baseline window: the swaps above, and the baseline balances held throughout */
const window = (overrides: Partial<PoolWindow> = {}): PoolWindow => ({
  windowStartMs: WINDOW_START,
  windowEndMs: WINDOW_END,
  swaps,
  tvlHistory: [sample(10n, 30_000n)],
  ...overrides,
});

const approx = (actual: number, expected: number, msg?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, msg ?? `expected ${expected}, got ${actual}`);

// ── pool APY ──────────────────────────────────────────────────────────────────

test("pool APY annualizes the window's LP fees over TVL when nothing changed", () => {
  const pool = buildPool(makeRaw(), prices, window());
  approx(pool.totalLiquidityUSD, 60_000);
  approx(pool.volume24hUSD, 100_000);
  approx(pool.apy, BASELINE_APY);
});

test("pool with no in-range liquidity still shows the fees it earned on its capital", () => {
  // the price sits outside every position: liquidity 0, but the capital and the fees are real
  const pool = buildPool(makeRaw({ liquidity: "0" }), prices, window());
  approx(pool.volume24hUSD, 100_000);
  approx(pool.apy, BASELINE_APY);
});

test("pool APY barely moves after 90% of the capital is withdrawn an hour ago", () => {
  const drained = makeRaw({
    liquidity: "100",
    token0Balance: WAD.toString(),
    token1Balance: (3_000n * WAD).toString(),
  });
  const tvlHistory = [
    sample(10n, 30_000n, WINDOW_START - HOUR_MS, WINDOW_END - HOUR_MS),
    sample(1n, 3_000n, WINDOW_END - HOUR_MS),
  ];
  const pool = buildPool(drained, prices, window({ tvlHistory }));
  approx(pool.totalLiquidityUSD, 6_000);
  approx(pool.volume24hUSD, 100_000, "reported volume is still the real volume");
  // time-weighted TVL: 23h at $60k + 1h at $6k = $57,750 → 189.61%
  approx(pool.apy, 189.61, "fees / today's TVL would have posted 1825%");
});

test("capital deposited after the swaps dilutes the APY", () => {
  const deepened = makeRaw({
    liquidity: "10000",
    token0Balance: (100n * WAD).toString(),
    token1Balance: (300_000n * WAD).toString(),
  });
  const tvlHistory = [
    sample(10n, 30_000n, WINDOW_START - HOUR_MS, WINDOW_END - MINUTE_MS),
    sample(100n, 300_000n, WINDOW_END - MINUTE_MS),
  ];
  const pool = buildPool(deepened, prices, window({ tvlHistory }));
  approx(pool.totalLiquidityUSD, 600_000);
  approx(pool.apy, (300 / 600_000) * 365 * 100); // 18.25%: today's TVL wins over the ~$60k average
});

test("a pool younger than the window is not extrapolated from its few hours", () => {
  // created an hour ago with the baseline balances; a day of its fees would be 24× what it saw
  const pool = buildPool(makeRaw(), prices, window({ tvlHistory: [sample(10n, 30_000n, WINDOW_END - HOUR_MS)] }));
  approx(pool.apy, BASELINE_APY);
});

test("missing TVL history falls back to today's TVL", () => {
  const pool = buildPool(makeRaw(), prices, window({ tvlHistory: [] }));
  approx(pool.apy, BASELINE_APY);
});

test("pools under the TVL floor report APY 0 even with a large average", () => {
  const dust = makeRaw({
    token0Balance: "0",
    token1Balance: (BigInt(V3_POOL_APY_MIN_TVL_USD - 1) * WAD).toString(),
  });
  const pool = buildPool(dust, prices, window());
  assert.equal(pool.apy, 0);
  approx(pool.volume24hUSD, 100_000);
  // exactly at the floor it is computed
  const atFloor = buildPool(
    makeRaw({ token0Balance: "0", token1Balance: (BigInt(V3_POOL_APY_MIN_TVL_USD) * WAD).toString() }),
    prices,
    window(),
  );
  assert.ok(atFloor.apy > 0);
});

test("protocol fee cut is deducted from the LP fee base", () => {
  // denominators 5 and 5 → protocol takes 1/5 of each side, LPs keep 80% → 146.00%
  const pool = buildPool(makeRaw({ feeProtocol: 5 + (5 << 4) }), prices, window());
  approx(pool.apy, BASELINE_APY * 0.8);
});

test("APY is rounded to two decimals so dust volume becomes an exact zero the UI hides", () => {
  // a 456-wei probe swap: real volume, but a yield around 1e-19 that would render as "0.00% APY"
  const dustSwap: Swap24h = { in0: 0n, in1: 456n, liquidity: 1000n };
  const pool = buildPool(makeRaw(), prices, window({ swaps: [dustSwap] }));
  assert.ok(pool.volume24hUSD > 0);
  assert.equal(pool.apy, 0);
});

test("no window → zero volume and zero APY", () => {
  const pool = buildPool(makeRaw(), prices);
  assert.equal(pool.volume24hUSD, 0);
  assert.equal(pool.apy, 0);
});

// ── time-weighted TVL ─────────────────────────────────────────────────────────

test("timeWeightedTvlUSD is undefined without samples", () => {
  assert.equal(timeWeightedTvlUSD(makeRaw(), prices, [], WINDOW_START, WINDOW_END), undefined);
});

test("timeWeightedTvlUSD clamps intervals to the window", () => {
  const samples = [
    sample(10n, 30_000n, WINDOW_START - DAY_MS, WINDOW_START + 12 * HOUR_MS), // $60k for the first half
    sample(0n, 0n, WINDOW_START + 12 * HOUR_MS), // empty for the second half, live row
  ];
  approx(timeWeightedTvlUSD(makeRaw(), prices, samples, WINDOW_START, WINDOW_END)!, 30_000);
});

test("timeWeightedTvlUSD counts time before the pool existed as zero", () => {
  const samples = [sample(10n, 30_000n, WINDOW_END - 6 * HOUR_MS)];
  approx(timeWeightedTvlUSD(makeRaw(), prices, samples, WINDOW_START, WINDOW_END)!, 15_000);
});

test("timeWeightedTvlUSD averages a pool whose capital churns in and out", () => {
  // alternating hours of $60k and empty across the whole day
  const samples = Array.from({ length: 24 }, (_, h) =>
    h % 2 === 0
      ? sample(10n, 30_000n, WINDOW_START + h * HOUR_MS, WINDOW_START + (h + 1) * HOUR_MS)
      : sample(0n, 0n, WINDOW_START + h * HOUR_MS, WINDOW_START + (h + 1) * HOUR_MS),
  );
  approx(timeWeightedTvlUSD(makeRaw(), prices, samples, WINDOW_START, WINDOW_END)!, 30_000);
});

// ── per-position attribution ──────────────────────────────────────────────────

test("attributableInputs scales each swap by the share of liquidity at that swap", () => {
  const swap = swapIn1(4_000n, 1000n);
  // 250 of 1000 → a quarter of the swap
  assert.deepEqual(attributableInputs([swap], 250n), { in0: 0n, in1: 1_000n * WAD });
  // token0-in swaps are scaled the same way
  assert.deepEqual(attributableInputs([{ in0: 800n, in1: 0n, liquidity: 1000n }], 250n), { in0: 200n, in1: 0n });
});

test("attributableInputs caps a swap at 100% when the liquidity exceeds what was in range", () => {
  const swap = swapIn1(4_000n, 1000n);
  assert.deepEqual(attributableInputs([swap], 2000n), { in0: 0n, in1: 4_000n * WAD });
});

test("attributableInputs skips swaps with no in-range liquidity and zero liquidity earns nothing", () => {
  assert.deepEqual(attributableInputs([swapIn1(4_000n, 0n)], 500n), { in0: 0n, in1: 0n });
  assert.deepEqual(attributableInputs([swapIn1(4_000n, 1000n)], 0n), { in0: 0n, in1: 0n });
});

test("attributableInputs mixes swaps executed at different liquidity levels per swap", () => {
  // a position of 100 units: full share of the $1k swap at L=100, a tenth of the $10k swap at L=1000
  const mixed = [swapIn1(1_000n, 100n), swapIn1(10_000n, 1000n)];
  assert.deepEqual(attributableInputs(mixed, 100n), { in0: 0n, in1: 2_000n * WAD });
});
