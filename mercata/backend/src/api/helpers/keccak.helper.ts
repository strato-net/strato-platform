/**
 * Keccak-256 (Ethereum MPT hash) — thin Buffer adapter around
 * `@noble/hashes/sha3`.
 *
 * Note: Keccak-256 ≠ NIST SHA3-256. They share the same permutation
 * (Keccak-f[1600]) but use different padding (0x01 vs 0x06). Node's
 * `createHash('sha3-256')` is the NIST variant — wrong for Ethereum.
 */
import { keccak_256 } from "@noble/hashes/sha3";

/** Keccak-256 (Ethereum). Returns a 32-byte Buffer. */
export function keccak256(data: Buffer | Uint8Array): Buffer {
  return Buffer.from(keccak_256(data));
}
