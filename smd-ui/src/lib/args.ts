import JSONbig from "json-bigint";

// Parse integers past 2^53 as native BigInts instead of silently rounding
// them through a JS double (the int-truncation half of issue #7353).
const JSONbigNative = JSONbig({ useNativeBigInt: true });

/** Bare (optionally negative) integer or decimal text, e.g. "42", "-7", "1.5". */
const isBareNumber = (s: string) => /^-?\d+(\.\d+)?$/.test(s);

/**
 * Recursively turn BigInt leaves into decimal strings so the value is
 * JSON-serializable; the node parses numeric strings exactly against the
 * declared or hinted Solidity type.
 */
export function bigintsToStrings(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(bigintsToStrings);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, bigintsToStrings(x)])
    );
  return v;
}

/**
 * Parse JSON text without losing integer precision: integers past 2^53 come
 * back as exact decimal strings instead of rounded doubles. Throws on invalid
 * JSON, like JSON.parse.
 */
export function parseJsonExact(text: string): unknown {
  return bigintsToStrings(JSONbigNative.parse(text));
}

/**
 * Parse a user-typed transaction argument. JSON.parse would turn a big
 * integer into a JS double and silently round everything past 2^53 (~9e15) —
 * corrupting amounts and rates in both Simulate and Submit — so a bare number
 * only keeps its numeric form when that form reproduces the typed text
 * exactly; otherwise the text passes through as a string, which the node
 * parses exactly against the declared or hinted type. Arrays, objects, and
 * booleans still parse (big integers inside them become exact strings), and
 * unparseable text falls back to the raw string.
 */
export function parseArgText(raw: string): unknown {
  const trimmed = raw.trim();
  if (isBareNumber(trimmed)) {
    const n = Number(trimmed);
    return String(n) === trimmed ? n : trimmed;
  }
  try {
    return parseJsonExact(raw);
  } catch {
    return raw;
  }
}

export interface TypedVariadicArg {
  type: string;
  value: unknown;
}

/**
 * Preserve an ABI argument's declared type while it travels through a variadic
 * parameter. Without the hint, bloc must infer the type from the value and can,
 * for example, interpret an all-digit address as an integer. The single outer
 * type also describes every nested value in arrays and structs.
 */
export function typedVariadicArg(
  type: string,
  raw: string,
  resolvedAddress?: string
): TypedVariadicArg {
  const normalizedType = type.trim();
  const lowerType = normalizedType.toLowerCase();
  const isAddress = lowerType === "address" || lowerType === "account";
  const value = lowerType === "string"
    ? raw
    : isAddress
      ? (resolvedAddress || raw).trim().replace(/^0x/i, "")
      : lowerType === "bool"
        ? (parseVariadicBoolean(raw) ?? parseArgText(raw))
        : lowerType === "byte" || /^bytes(?:\d+)?$/.test(lowerType)
          ? (raw.trim().startsWith('"') ? parseArgText(raw) : raw.trim())
        : parseArgText(raw);
  return { type: normalizedType, value };
}

/** Strip a transaction-only type hint for issue-list display and optimistic state. */
export function variadicArgValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).type === "string" &&
      Object.prototype.hasOwnProperty.call(value, "value")) {
    return (value as TypedVariadicArg).value;
  }
  return value;
}

/** Keep variadic arguments typed when they pass through a text field or event. */
export function formatVariadicArg(value: unknown): string {
  if (typeof value === "boolean") return `bool(${value})`;
  if (value !== null && typeof value === "object") return JSON.stringify(bigintsToStrings(value));
  return String(value);
}

/** Decode a boolean rendered by Cirrus/SolidVM, including its explicit cast form. */
export function parseVariadicBoolean(value: unknown): boolean | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "bool(true)") return true;
  if (normalized === "false" || normalized === "bool(false)") return false;
  return null;
}
