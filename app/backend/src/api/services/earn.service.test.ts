import assert from "node:assert/strict";
import test from "node:test";
import type { ApySource, PoolV3 } from "@strato/shared-types";
import { hiddenSwapPools } from "../../config/config";
import { addV3PoolApys } from "./earn.service";

const WAD = 10n ** 18n;
const TOKEN0 = "a".repeat(40);
const TOKEN1 = "b".repeat(40);
const POOL = "c".repeat(40);

// wstETH at $3,000 and USDST at $1
const prices = new Map<string, string>([
  [TOKEN0, (3000n * WAD).toString()],
  [TOKEN1, WAD.toString()],
]);

const makePool = (overrides: Partial<PoolV3> = {}): PoolV3 => ({
  address: POOL,
  token0: { address: TOKEN0, name: "Wrapped stETH", symbol: "wstETH", decimals: 18 },
  token1: { address: TOKEN1, name: "USDST", symbol: "USDST", decimals: 18 },
  fee: 3000,
  tickSpacing: 60,
  sqrtPriceX96: "1",
  currentTick: 0,
  liquidity: "1",
  priceWad: "1",
  oraclePriceWad: "1",
  token0Balance: (10n * WAD).toString(), // $30,000
  token1Balance: (10_000n * WAD).toString(), // $10,000
  feeProtocol: 0,
  protocolFees0: "0",
  protocolFees1: "0",
  totalLiquidityUSD: 40_000,
  volume24hUSD: 5_000,
  apy: 12.345,
  isPaused: false,
  isDisabled: false,
  poolName: "wstETH/USDST 0.3%",
  ...overrides,
});

const collector = () => {
  const map = new Map<string, ApySource[]>();
  const add = (token: string, entry: ApySource) => {
    const arr = map.get(token);
    if (arr) arr.push(entry);
    else map.set(token, [entry]);
  };
  return { map, add };
};

test("V3 fee APY is a Native swap source on both tokens and on the pool key", () => {
  const { map, add } = collector();
  addV3PoolApys(add, [makePool()], prices, new Map());

  const expected: ApySource = { source: "swap", apy: "12.35", meta: "wstETH-USDST 0.3% V3", poolAddress: POOL };
  assert.deepEqual(map.get(TOKEN0), [expected]);
  assert.deepEqual(map.get(TOKEN1), [expected]);
  assert.deepEqual(map.get(POOL), [expected]);
});

test("token base yield attaches per token and TVL-weighted on the pool key", () => {
  const { map, add } = collector();
  addV3PoolApys(add, [makePool()], prices, new Map([[TOKEN0, 2.8]]));

  // (30,000 × 2.8 + 10,000 × 0) / 40,000 = 2.10
  assert.ok(map.get(POOL)!.some((e) => e.source === "weighted_swap" && e.apy === "2.10"));
  assert.ok(map.get(TOKEN0)!.some((e) => e.source === "base" && e.apy === "2.80" && e.poolAddress === POOL));
  assert.ok(!map.get(TOKEN1)!.some((e) => e.source === "base"));
});

test("paused, disabled, thin, hidden and fee-less pools emit nothing", (t) => {
  hiddenSwapPools.add("d".repeat(40));
  t.after(() => hiddenSwapPools.delete("d".repeat(40)));

  const { map, add } = collector();
  addV3PoolApys(add, [
    makePool({ isPaused: true }),
    makePool({ isDisabled: true }),
    makePool({ totalLiquidityUSD: 999.99 }),
    makePool({ address: "d".repeat(40) }),
    makePool({ apy: 0 }),
    makePool({ apy: 0.004 }), // rounds to 0.00
    makePool({ apy: Number.NaN }),
  ], prices, new Map());

  assert.equal(map.size, 0);
});

test("pool addresses are normalized before hidden-pool and key lookups", () => {
  const { map, add } = collector();
  addV3PoolApys(add, [makePool({ address: `0x${POOL.toUpperCase()}` })], prices, new Map());

  assert.ok(map.has(POOL));
  assert.equal(map.get(TOKEN0)![0].poolAddress, POOL);
});
