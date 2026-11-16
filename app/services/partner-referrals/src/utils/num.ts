// Chain amounts are uint256: far beyond Number's 53 bits. Everything here
// keeps them as decimal strings (Postgres NUMERIC) or BigInt.

/**
 * JSON.parse silently rounds long integer literals (1.0001e+22). Quote any
 * bare integer literal of 16+ digits before parsing so it survives as a
 * string. String literals are matched first and left alone: Cirrus renders
 * an array attribute as JSON text inside a string, and its numbers are
 * handled when that text is parsed in turn.
 */
export const parseJsonPreservingBigInts = (text: string): unknown =>
  JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}/g, (m) => (m[0] === '"' ? m : `"${m}"`)));

/** A uint/int from a decimal string or a safe number; null otherwise. */
export const toBigInt = (v: unknown): bigint | null => {
  if (typeof v === "number") return Number.isSafeInteger(v) ? BigInt(v) : null;
  return typeof v === "string" && /^-?\d+$/.test(v.trim()) ? BigInt(v.trim()) : null;
};

/** Lowercase 40-hex address without 0x, or null when it is not an address. */
export const toAddress = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{40}$/.test(s) ? s : null;
};
