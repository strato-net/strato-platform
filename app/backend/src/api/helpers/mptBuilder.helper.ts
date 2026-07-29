/**
 * Receipts-trie builder + proof extractor — thin Buffer adapter
 * around `@ethereumjs/trie`.
 *
 * Replaces the previous bespoke divide-and-conquer trie + HP encoder
 * (~330 lines) with the canonical implementation. The shape is
 * narrower than the lib API on purpose: the bridge-proof pipeline
 * always needs (a) the root and (b) a proof for exactly one key, so
 * we expose a single async helper that does both. If a future use
 * case needs more, drop down to `new Trie()` directly.
 *
 * `useKeyHashing` defaults to false — that's correct for the receipts
 * / transactions tries, where keys are raw rlp(index). Storage and
 * state tries use `useKeyHashing: true`.
 */
import { Trie } from "@ethereumjs/trie";

/**
 * Build an MPT from (key, value) pairs and extract a proof for a
 * single key. Returns the trie root and the root-to-leaf proof
 * (RLP-encoded trie nodes) the on-chain MPT verifier expects.
 */
export async function buildTrieAndProof(
  pairs: Array<[Buffer, Buffer]>,
  proofKey: Buffer,
): Promise<{ root: Buffer; proof: Buffer[] }> {
  const trie = new Trie();
  for (const [k, v] of pairs) {
    await trie.put(k, v);
  }
  const root = Buffer.from(trie.root());
  const rawProof = await trie.createProof(proofKey);
  return {
    root,
    proof: rawProof.map((n) => Buffer.from(n)),
  };
}
