// Chain amounts are uint256: far beyond Number's 53 bits. Everything here
// keeps them as decimal strings (Postgres NUMERIC) or BigInt.

/**
 * JSON.parse silently rounds long integer literals (1.0001e+22). Quote any
 * integer literal of 16+ digits before parsing so it survives as a string.
 * Cirrus returns uint256 attributes as bare numbers, which is exactly this bug.
 */
export const parseJsonPreservingBigInts = (text: string): unknown =>
  JSON.parse(text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"'));

const DEC_RE = /^-?\d+$/;
const HEX_RE = /^0x[0-9a-fA-F]+$/;

/** A uint/int as a decimal string, from a decimal string, hex string or number. */
export const toDecimalString = (v: unknown): string | null => {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isSafeInteger(v) ? String(v) : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (DEC_RE.test(s)) return s;
    if (HEX_RE.test(s)) return BigInt(s).toString();
    return null;
  }
  return null;
};

export const toBigInt = (v: unknown): bigint | null => {
  const s = toDecimalString(v);
  return s === null ? null : BigInt(s);
};

/** Lowercase 40-hex address without 0x, or null when it is not an address. */
export const toAddress = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{40}$/.test(s) ? s : null;
};

/** 32-byte hash as lowercase hex without 0x. */
export const toHash = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
};

/**
 * out / in as a decimal string with 18 fractional digits; the price of one
 * unit of the input token in the output token, in raw (undecimalized) units.
 */
export const ratio18 = (numerator: bigint, denominator: bigint): string | null => {
  if (denominator === 0n) return null;
  const scaled = (numerator * 10n ** 18n) / denominator;
  const s = scaled.toString().padStart(19, "0");
  return `${s.slice(0, -18)}.${s.slice(-18)}`;
};
