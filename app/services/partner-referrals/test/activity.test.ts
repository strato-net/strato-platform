// Checks that need no database: which events count, for whom, and at what
// USD value. Run with `npm test`.
process.env.METAL_FORGE = "f0".repeat(20);
import assert from "assert";
import { activityOf, ChainEvent, learn, State } from "../src/indexer/activity";
import { fromCirrusRow } from "../src/indexer/cirrus";
import { parseJsonPreservingBigInts } from "../src/utils/num";

const oracle = "0000000000000000000000000000000000001002";
const factory = "000000000000000000000000000000000000100a";
const lendingPool = "0000000000000000000000000000000000001005";
const bridge = "0000000000000000000000000000000000001008";
const cdpEngine = "0000000000000000000000000000000000001011";
const metalForge = "f0".repeat(20);
const usdst = "aa".repeat(20);
const eth = "bb".repeat(20);
const unpriced = "cc".repeat(20);
const pool = "d1".repeat(20);
const poolV3 = "d3".repeat(20);
const alice = "11".repeat(20);
const router = "22".repeat(20);

let id = 0;
const ev = (name: string, address: string, args: Record<string, unknown>, txSender = alice): ChainEvent => ({
  id: ++id, address, name, blockTs: new Date("2026-11-11T12:00:00Z"), txSender, args,
});
const state: State = { prices: new Map(), pools: new Map(), dirtyPrices: new Set(), dirtyPools: new Set() };
const usd = (e: ChainEvent) => activityOf(e, state)?.usdWad.toString() ?? null;

// A Cirrus row as served: uint256 as bare numbers, arrays as JSON text.
const raw = `[{"id":7,"address":"${oracle}","block_timestamp":"2026-11-11 12:00:00 UTC","transaction_sender":"${alice}","event_name":"BatchPricesUpdated","attributes":{"assets":"[\\"${usdst}\\", \\"${eth}\\"]","priceValues":"[1000000000000000000, 2000000000000000000000]"}}]`;
const batch = fromCirrusRow((parseJsonPreservingBigInts(raw) as any[])[0])!;
assert.strictEqual(batch.blockTs.toISOString(), "2026-11-11T12:00:00.000Z");

// Prices and pools are only learned from the trusted oracle and factory
learn({ ...batch, address: "ee".repeat(20) }, state);
learn(ev("NewPool", "ee".repeat(20), { pool, tokenA: usdst, tokenB: eth }), state);
assert.strictEqual(state.prices.size + state.pools.size, 0, "untrusted emitters teach nothing");
learn(batch, state);
learn(ev("NewPool", factory, { pool, tokenA: usdst, tokenB: eth }), state);
learn(ev("NewPoolV3", factory, { pool: poolV3, tokenA: eth, tokenB: unpriced, fee: "3000" }), state);
assert.strictEqual(state.prices.get(eth), 2000n * 10n ** 18n);
assert.deepStrictEqual([...state.dirtyPools], [pool, poolV3]);

// Swaps: valued by the input, credited to the transaction's sender
const swap = { sender: router, tokenIn: eth, tokenOut: usdst, amountIn: "500000000000000000", amountOut: "1" };
assert.deepStrictEqual(activityOf(ev("Swap", pool, swap), state), {
  eventId: id, account: alice, blockTs: new Date("2026-11-11T12:00:00Z"), usdWad: 1000n * 10n ** 18n,
});
assert.strictEqual(usd(ev("Swap", "ee".repeat(20), swap)), null, "a Swap from an unknown contract is not counted");
assert.strictEqual(usd(ev("Swap", pool, { ...swap, tokenIn: unpriced })), "1", "falls back to the output leg");
// PoolV3: signed amounts, tokens from the factory's NewPoolV3
assert.strictEqual(usd(ev("Swap", poolV3, { amount0: "-1000000000000000000", amount1: "5" })), (2000n * 10n ** 18n).toString());

// The other counted events, each from its trusted contract only
const deposit = { asset: usdst, amount: "250000000000000000000" };
const expected = (250n * 10n ** 18n).toString();
assert.strictEqual(usd(ev("MetalMinted", metalForge, { buyer: alice, payToken: usdst, payAmount: deposit.amount })), expected);
assert.strictEqual(usd(ev("DepositCompleted", bridge, { stratoRecipient: alice, stratoToken: usdst, stratoTokenAmount: deposit.amount }, router)), expected);
assert.strictEqual(usd(ev("Deposited", lendingPool, { user: alice, ...deposit })), expected);
assert.strictEqual(usd(ev("SuppliedCollateral", lendingPool, { user: alice, ...deposit })), expected);
assert.strictEqual(usd(ev("Deposited", cdpEngine, { owner: alice, ...deposit })), expected);
assert.strictEqual(usd(ev("Deposited", "ee".repeat(20), { user: alice, ...deposit })), null);
assert.strictEqual(usd(ev("Deposited", lendingPool, { user: alice, asset: unpriced, amount: "1" })), null, "unpriced asset");

console.log("activity.test: OK");
