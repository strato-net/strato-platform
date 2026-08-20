import { jsonrepair } from "jsonrepair";

const legacyEscapes: Record<string, string> = {
  "8212": "—",
  "8216": "‘",
  "8217": "’",
  "8220": "“",
  "8221": "”",
};

export const normalizeLegacyEscapes = (value: string): string =>
  value.replace(/\\(8212|8216|8217|8220|8221)/g, (_, code) => legacyEscapes[code] || code);

const STRUCT_TYPE_NAME = /(^|[\[{,:]\s*)[A-Za-z_$][\w$]*\s*\{/g;

// Quoted strings are copied through untouched: their contents can hold the same
// `, Foo {` shape, and rewriting those would change the value being parsed
const stripStructTypeNames = (s: string): string => {
  let out = "";
  let outside = "";
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      out += c;
      if (c === "\\") out += s[++i] ?? "";
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      out += outside.replace(STRUCT_TYPE_NAME, "$1{") + c;
      outside = "";
      quote = c;
      continue;
    }
    outside += c;
  }
  return out + outside.replace(STRUCT_TYPE_NAME, "$1{");
};

/**
 * Repairs the node's own rendering of a composite value into strict JSON: it prefixes
 * structs with their type name (`ActionableEvent {…}`) and can leave identifiers
 * unquoted, neither of which `JSON.parse` accepts.
 *
 * Only ever point this at values read back from the node. Running it over text a user
 * typed resolves malformed input to *something* instead of rejecting it, which is a
 * different bug entirely (see admin_ui_arg_fidelity_test_matrix.md, D2/D3/D4).
 */
export const repairStructuredJson = (value: string): string =>
  jsonrepair(stripStructTypeNames(normalizeLegacyEscapes(value)));
