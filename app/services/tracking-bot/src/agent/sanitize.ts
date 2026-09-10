// Models occasionally emit a structured tool call as text and the raw markup
// leaks into the field values (issue #7473: a decisionReason that ended with
// "</decisionReason>\n<parameter name=\"reply\">" was posted verbatim on the
// issue, and every field after it was lost). Strip that markup before any
// model-produced string is shown to a human or used for a decision.

const TOOL_TAGS = [
  "function_calls",
  "function_call",
  "function_results",
  "invoke",
  "parameter",
  "tool_use",
  "tool_call",
  "tool_result",
  "arguments",
];

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// <tag ...>, </tag> and <tag ...> for the given tag names only — legit
// markdown/HTML in a reply body is left alone.
const tagPattern = (tags: string[]): RegExp =>
  new RegExp(`<\\/?(?:[a-z]+:)?(?:${tags.map(escape).join("|")})(?:\\s[^<>]*)?\\/?>`, "gi");

export const stripToolMarkup = (text: string, fieldNames: string[] = []): string =>
  text
    .replace(tagPattern([...TOOL_TAGS, ...fieldNames]), "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const sanitizeStrings = <T extends Record<string, unknown>>(value: T, fieldNames: string[] = []): T => {
  const clean = (v: unknown): unknown => {
    if (typeof v === "string") return stripToolMarkup(v, fieldNames);
    if (Array.isArray(v)) return v.map(clean);
    return v;
  };
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)])) as T;
};
