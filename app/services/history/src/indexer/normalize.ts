import { parseJsonPreservingBigInts, toAddress, toHash } from "../utils/num";

/**
 * One chain event in the shape the apply step understands, whichever feed it
 * came from. Argument values are decimal strings, lowercase hex addresses,
 * booleans, strings, or arrays of those.
 */
export interface NormalizedEvent {
  source: "bus" | "cirrus";
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

/** Chain order of an event (and of an element inside a batch event). */
export const ord = (blockNumber: number, eventIndex: number, sub = 0): string =>
  (BigInt(blockNumber) * 1000000n + BigInt(eventIndex) * 1000n + BigInt(sub)).toString();

// --- bus: {"version":1,"event":<AggregateEvent>} from slipstream's egress ---

const decodeBusValue = (v: any): unknown => {
  if (v === null || v === undefined || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(decodeBusValue);
  switch (v.t) {
    case "int":
    case "dec":
    case "str":
    case "bytes":
      return v.v;
    case "bool":
      return v.v;
    case "addr":
    case "contract":
      return String(v.v).toLowerCase();
    case "arr":
    case "tup":
      return (v.v || []).map(decodeBusValue);
    case "struct":
      return Object.fromEntries(Object.entries(v.v || {}).map(([k, x]) => [k, decodeBusValue(x)]));
    default:
      return v;
  }
};

export const fromBusEnvelope = (raw: string): NormalizedEvent | null => {
  let envelope: any;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!envelope || envelope.version !== 1 || !envelope.event) return null;
  const e = envelope.event;
  const ev = e.eventEvent;
  if (!ev) return null;
  const address = toAddress(ev.eventContractAddress);
  const blockTs = new Date(e.eventBlockTimestamp);
  if (!address || Number.isNaN(blockTs.getTime())) return null;
  const args: Record<string, unknown> = {};
  for (const item of ev.eventArgs || []) {
    // evArgs is a 4-tuple (name, value, source text, type), serialised as an array
    if (Array.isArray(item) && typeof item[0] === "string") args[item[0]] = decodeBusValue(item[1]);
  }
  return {
    source: "bus",
    contractName: String(ev.eventContractName || ""),
    address,
    name: String(ev.eventName || ""),
    blockNumber: Number(e.eventBlockNumber),
    blockTs,
    eventIndex: Number(e.eventIndex),
    txHash: toHash(ev.eventTxHash),
    sender: toAddress(e.eventTxSender),
    args,
  };
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
