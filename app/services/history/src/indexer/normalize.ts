import { parseJsonPreservingBigInts, toAddress, toHash } from "../utils/num";

/**
 * One chain event in the shape the apply step understands. Argument values
 * are decimal strings, lowercase hex addresses, booleans, strings, or arrays
 * of those.
 */
export interface NormalizedEvent {
  source: "cirrus";
  contractName: string;
  address: string;
  name: string;
  blockNumber: number;
  blockTs: Date;
  eventIndex: number;
  txHash: string | null;
  sender: string | null;
  args: Record<string, unknown>;
  /** Cirrus event id, for the poller's cursor. */
  cursor?: number;
}

/**
 * Chain order of an event (and of an element inside a batch event), as one
 * NUMERIC: block << 64 | eventIndex << 32 | sub. The two low fields are
 * 32-bit, the width of an event index on the chain, so no block or batch
 * event can wrap into its neighbour; a value outside that range is refused
 * rather than silently colliding.
 */
export const ord = (blockNumber: number, eventIndex: number, sub = 0): string => {
  const field = (v: number, what: string): bigint => {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`${what} ${v} is outside the 32-bit ordering field`);
    return BigInt(v);
  };
  return ((BigInt(blockNumber) << 64n) | (field(eventIndex, "eventIndex") << 32n) | field(sub, "sub")).toString();
};

// --- Cirrus: rows of the global `event` table (PostgREST) ---

export interface CirrusEventRow {
  id: number | string;
  address: string;
  block_hash: string;
  transaction_hash: string;
  block_timestamp: string;
  block_number: string | number;
  transaction_sender: string;
  event_index: number | string;
  event_name: string;
  attributes: Record<string, unknown> | string | null;
}

// Cirrus renders block_timestamp as text, e.g. "2026-09-04 12:00:00 UTC" or
// ISO 8601; both are read.
export const parseCirrusTimestamp = (s: string): Date => {
  const direct = new Date(s);
  if (!Number.isNaN(direct.getTime())) return direct;
  return new Date(`${s.trim().replace(/ UTC$/, "").replace(" ", "T")}Z`);
};

const decodeCirrusAttribute = (v: unknown): unknown => {
  if (typeof v === "number") return Number.isSafeInteger(v) ? String(v) : null;
  if (typeof v === "string") {
    const s = v.trim();
    // Array-typed attributes arrive as JSON text inside the jsonb
    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const parsed = parseJsonPreservingBigInts(s);
        if (Array.isArray(parsed)) return parsed.map(decodeCirrusAttribute);
      } catch {
        return v;
      }
    }
    return v;
  }
  if (Array.isArray(v)) return v.map(decodeCirrusAttribute);
  return v;
};

export const fromCirrusRow = (row: CirrusEventRow): NormalizedEvent | null => {
  const address = toAddress(row.address);
  if (!address) return null;
  const blockTs = parseCirrusTimestamp(String(row.block_timestamp));
  if (Number.isNaN(blockTs.getTime())) return null;
  let rawAttrs: any = row.attributes;
  if (typeof rawAttrs === "string") {
    try {
      rawAttrs = parseJsonPreservingBigInts(rawAttrs);
    } catch {
      rawAttrs = {};
    }
  }
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawAttrs || {})) args[k] = decodeCirrusAttribute(v);
  return {
    source: "cirrus",
    contractName: "",
    address,
    name: String(row.event_name || ""),
    blockNumber: Number(row.block_number),
    blockTs,
    eventIndex: Number(row.event_index),
    txHash: toHash(row.transaction_hash),
    sender: toAddress(row.transaction_sender),
    args,
    cursor: Number(row.id),
  };
};
