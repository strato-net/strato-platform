/**
 * Minimal SSZ helpers needed for the trustless bridge-in's
 * pre-hashing step. We compute hash_tree_root for the two EPH fields
 * the on-chain Solidity {@link SSZHashTree.hashTreeRootEPH} expects
 * pre-hashed:
 *
 *   logsBloomRoot — hash_tree_root of execution_payload.logs_bloom
 *                   (ByteVector[256]; 8 chunks merkleized to depth 3).
 *   extraDataRoot — hash_tree_root of execution_payload.extra_data
 *                   (ByteList[32]; chunked + length mixin).
 *
 * Pre-hashing on the backend keeps calldata bounded — the contract
 * never sees the raw 256-byte bloom or the variable extra_data.
 */
import { createHash } from "crypto";

/** SHA-256 of `buf`, returning a 32-byte Buffer. */
export function sha256(buf: Buffer): Buffer {
  return createHash("sha256").update(buf).digest();
}

/**
 * Decode a 0x-prefixed hex string (or unprefixed) into a Buffer.
 * Tolerant of mixed case; rejects odd-length input as malformed.
 */
export function hexToBuffer(hex: string): Buffer {
  const stripped = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (stripped.length % 2 !== 0) throw new Error(`hexToBuffer: odd-length hex (${stripped.length})`);
  return Buffer.from(stripped, "hex");
}

/** Encode a Buffer back to a 0x-prefixed lowercase hex string. */
export function bufferToHex(buf: Buffer): string {
  return "0x" + buf.toString("hex");
}

/**
 * Merkleize an array of 32-byte chunks. The chunk count must be a
 * power of two; pad the input with zero chunks before calling if
 * needed. Returns the 32-byte merkle root.
 */
export function merkleizeChunks(chunks: Buffer[]): Buffer {
  if (chunks.length === 0) throw new Error("merkleizeChunks: empty input");
  if ((chunks.length & (chunks.length - 1)) !== 0) {
    throw new Error(`merkleizeChunks: chunk count must be a power of two (got ${chunks.length})`);
  }
  let layer = chunks;
  while (layer.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(sha256(Buffer.concat([layer[i], layer[i + 1]])));
    }
    layer = next;
  }
  return layer[0];
}

/**
 * hash_tree_root of a SSZ ByteVector[N]: pack N raw bytes into
 * ⌈N/32⌉ chunks (right-pad the last chunk with zeros), pad up to
 * the next power of two with zero chunks, merkleize.
 *
 * For execution_payload.logs_bloom: N = 256 → 8 chunks (already a
 * power of two), depth 3.
 */
export function hashTreeRootByteVector(value: Buffer, fixedSize: number): Buffer {
  if (value.length !== fixedSize) {
    throw new Error(`hashTreeRootByteVector: expected ${fixedSize} bytes, got ${value.length}`);
  }
  const chunks: Buffer[] = [];
  for (let i = 0; i < value.length; i += 32) {
    const slice = value.subarray(i, i + 32);
    if (slice.length === 32) {
      chunks.push(slice);
    } else {
      const padded = Buffer.alloc(32);
      slice.copy(padded);
      chunks.push(padded);
    }
  }
  // Round up to next power of two with zero chunks.
  let nChunks = 1;
  while (nChunks < chunks.length) nChunks *= 2;
  while (chunks.length < nChunks) chunks.push(Buffer.alloc(32));
  return merkleizeChunks(chunks);
}

/**
 * Encode a non-negative integer ≤ 2^256 as a 32-byte little-endian
 * SSZ leaf. Used for the length-mixin in ByteList hash_tree_root.
 */
export function uint256ToLELeaf(value: bigint | number): Buffer {
  const out = Buffer.alloc(32);
  let v = BigInt(value);
  for (let i = 0; i < 32 && v > 0n; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * hash_tree_root of a SSZ ByteList[maxLen]: chunk the actual data,
 * merkleize WITH LIMIT (= ⌈maxLen/32⌉ chunks of capacity), then mix
 * in the actual byte length:
 *
 *   root = sha256(chunkRoot || uint256_le(actualLen))
 *
 * For execution_payload.extra_data: maxLen = 32 → exactly 1 chunk
 * limit, so chunkRoot is just that single (zero-padded) chunk.
 */
export function hashTreeRootByteList(value: Buffer, maxLen: number): Buffer {
  if (value.length > maxLen) {
    throw new Error(`hashTreeRootByteList: data length ${value.length} exceeds maxLen ${maxLen}`);
  }
  const chunkLimit = Math.max(1, Math.ceil(maxLen / 32));

  // Pack data into chunks (right-pad final chunk with zeros).
  const chunks: Buffer[] = [];
  for (let i = 0; i < value.length; i += 32) {
    const slice = value.subarray(i, i + 32);
    if (slice.length === 32) {
      chunks.push(slice);
    } else {
      const padded = Buffer.alloc(32);
      slice.copy(padded);
      chunks.push(padded);
    }
  }

  // Merkleize WITH LIMIT — pad up to chunkLimit (rounded to next
  // power of two) with zero chunks. For maxLen=32 this is 1 chunk
  // total → no merkleization, the single chunk IS the chunkRoot.
  let limitPow2 = 1;
  while (limitPow2 < chunkLimit) limitPow2 *= 2;
  while (chunks.length < limitPow2) chunks.push(Buffer.alloc(32));
  const chunkRoot = limitPow2 === 1 ? chunks[0] : merkleizeChunks(chunks);

  return sha256(Buffer.concat([chunkRoot, uint256ToLELeaf(value.length)]));
}
