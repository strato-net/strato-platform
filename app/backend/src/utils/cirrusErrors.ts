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

/** `.catch` handler for a Cirrus read: yield an empty result only when the table/column
 *  doesn't exist yet; rethrow anything else. */
export const emptyOnMissingTable = (err: unknown): { data: [] } => {
  if (isMissingTableError(err)) return { data: [] };
  throw err;
};
