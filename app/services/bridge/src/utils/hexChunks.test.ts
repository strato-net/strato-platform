import assert from "node:assert/strict";
import test from "node:test";
import { chunkBytes32 } from "./hexChunks";

/**
 * chunkBytes32 turns the 64-byte participation bitvector into the bytes32[2]
 * SolidVM wants. It is worth testing on its own because a mistake here is
 * silent: the proof would be submitted against a different bitfield than the
 * anchor uses, the verifier would reject it, and nothing would say why.
 */

test("splits 64 bytes into two bytes32 chunks", () => {
  const bits = "0x" + "ab".repeat(32) + "cd".repeat(32);
  assert.deepEqual(chunkBytes32(bits, 2), ["ab".repeat(32), "cd".repeat(32)]);
});

test("preserves order, so chunk 0 is the low half of the bitvector", () => {
  const first = "01" + "00".repeat(31);
  const second = "02" + "00".repeat(31);
  const [a, b] = chunkBytes32("0x" + first + second, 2);
  assert.equal(a, first);
  assert.equal(b, second);
});

test("accepts an unprefixed string", () => {
  const bits = "ff".repeat(64);
  assert.deepEqual(chunkBytes32(bits, 2), ["ff".repeat(32), "ff".repeat(32)]);
});

test("drops no data: chunks rejoin to the input", () => {
  const bits = Array.from({ length: 64 }, (_, i) => i.toString(16).padStart(2, "0")).join("");
  assert.equal(chunkBytes32("0x" + bits, 2).join(""), bits);
});

/** A short bitfield must fail loudly rather than pad or truncate -- padding
 *  would change which validators the proof claims signed. */
test("refuses a bitfield of the wrong length", () => {
  assert.throws(() => chunkBytes32("0x" + "ab".repeat(63), 2), /expected 64 bytes, got 63/);
  assert.throws(() => chunkBytes32("0x" + "ab".repeat(65), 2), /expected 64 bytes/);
  assert.throws(() => chunkBytes32("0x", 2), /expected 64 bytes/);
});
