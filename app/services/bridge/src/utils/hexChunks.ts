/**
 * Split a 0x-prefixed byte string into `n` bytes32 chunks, the shape SolidVM
 * wants for a fixed-size bytes32 array argument.
 *
 * Kept free of any config or client imports so it can be tested on its own: a
 * mistake here is silent. The proof would be submitted against a different
 * participation bitfield than the anchor uses, the verifier would reject it,
 * and nothing would say why.
 */
export const chunkBytes32 = (hex: string, n: number): string[] => {
  const raw = hex.replace(/^0x/, "");
  if (raw.length !== n * 64) {
    throw new Error(`chunkBytes32: expected ${n * 32} bytes, got ${raw.length / 2}`);
  }
  return Array.from({ length: n }, (_, i) => raw.slice(i * 64, (i + 1) * 64));
};

export default { chunkBytes32 };
