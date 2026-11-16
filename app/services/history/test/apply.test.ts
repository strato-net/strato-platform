// Checks that need no database: Cirrus row
// normalisation and the number helpers. Run with `npm test`.
import assert from "assert";
import { fromCirrusRow, ord } from "../src/indexer/normalize";
import { parseJsonPreservingBigInts, ratio18, toAddress, toBigInt } from "../src/utils/num";

const addr = "d3b4b0e2b2c3d4e5f60718293a4b5c6d7e8f9a0b";


// Cirrus renders uint256 attributes as bare numbers: the raw text must be
// parsed with the big-int guard, and arrays arrive as JSON text.
const raw = `[{"id":42,"address":"${addr}","block_hash":"x","transaction_hash":"${"cc".repeat(32)}","block_timestamp":"2026-09-04 12:00:00 UTC","block_number":"506008","transaction_sender":"${addr}","event_index":1,"event_name":"BatchPricesUpdated","attributes":{"assets":"[\\"${addr}\\"]","priceValues":[100010000000000000000000],"timestamp":1757000000}}]`;
const rows = parseJsonPreservingBigInts(raw) as any[];
assert.strictEqual(rows[0].attributes.priceValues[0], "100010000000000000000000", "big literal preserved");
const cev = fromCirrusRow(rows[0]);
assert(cev, "cirrus row parses");
assert.strictEqual(cev.blockNumber, 506008);
assert.strictEqual(cev.cursor, 42);
assert.strictEqual(cev.blockTs.toISOString(), "2026-09-04T12:00:00.000Z");
assert.deepStrictEqual(cev.args.assets, [addr]);
assert.deepStrictEqual(cev.args.priceValues, ["100010000000000000000000"]);

assert.strictEqual(ord(512345, 3, 7), ((512345n << 64n) | (3n << 32n) | 7n).toString());
assert.throws(() => ord(1, 2 ** 32, 0));
assert.strictEqual(ratio18(3n, 2n), "1.500000000000000000");
assert.strictEqual(ratio18(1n, 3n), "0.333333333333333333");
assert.strictEqual(ratio18(1n, 0n), null);
assert.strictEqual(toAddress("0xABCDEF0123456789ABCDEF0123456789ABCDEF01"), "abcdef0123456789abcdef0123456789abcdef01");
assert.strictEqual(toAddress("nope"), null);
assert.strictEqual(toBigInt("0x10"), 16n);
assert.strictEqual(toBigInt(1e22), null, "unsafe numbers are rejected, not rounded");

console.log("apply.test: ok");
