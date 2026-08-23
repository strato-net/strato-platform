/**
 * RLP encoder — thin Buffer adapter around `@ethereumjs/rlp`.
 *
 * The lib's encode() returns Uint8Array and accepts numbers / bigints
 * natively, so the only thing this module does is normalize to Buffer
 * (the rest of the bridge-proof pipeline still uses Buffer for RPC /
 * keccak interop).
 */
import { RLP } from "@ethereumjs/rlp";

/** What our callers pass in. The lib accepts a wider Input type, but
 *  we only need bytes-or-list for the receipts-trie use case. */
export type RlpInput = Uint8Array | RlpInput[];

/** RLP-encode a value or nested list. */
export function rlpEncode(value: RlpInput): Buffer {
  return Buffer.from(RLP.encode(value as any));
}

/** Encode a non-negative integer as canonical RLP minimum-byte BE.
 *  RLP.encode handles bigint directly (and emits 0x80 for n === 0n,
 *  per the Yellow-Paper "no leading zero" rule). */
export function rlpEncodeUint(n: number | bigint): Buffer {
  const v = BigInt(n);
  if (v < 0n) throw new Error("rlpEncodeUint: negative");
  return Buffer.from(RLP.encode(v));
}
