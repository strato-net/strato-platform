// STRATO indexes contract state into Cirrus lazily: a contract type's table appears only
// once the first contract exists (Postgres SQLSTATE 42P01, undefined_table, until then)
// and some mapping-value columns materialize only with the first row (42703,
// undefined_column). Both simply mean "no data yet" and may be swallowed as an empty
// result. Anything else — including a bare HTTP 404, which indicates a misrouted URL
// rather than an empty table — must propagate so it surfaces as a retryable error
// instead of a misleading empty/not-found answer.
export const isMissingTableError = (err: unknown): boolean => {
  const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
  return code === "42P01" || code === "42703";
};

/** `isMissingTableError`, or a select that embeds a table that does not exist yet, which
 *  PostgREST refuses itself (PGRST200, no relationship to it). An embed without a foreign
 *  key answers the same code, so a caller that reads this as "no data yet" should know the
 *  tables its select embeds. The node call watch (sharedPromise.ts) uses it only to tell
 *  what is not a failed call. */
export const isMissingRelationError = (err: unknown): boolean =>
  isMissingTableError(err) ||
  (err as { response?: { data?: { code?: string } } })?.response?.data?.code === "PGRST200";

/** `.catch` handler for a Cirrus read: yield an empty result only when the table/column
 *  doesn't exist yet; rethrow anything else. */
export const emptyOnMissingTable = (err: unknown): { data: [] } => {
  if (isMissingTableError(err)) return { data: [] };
  throw err;
};
