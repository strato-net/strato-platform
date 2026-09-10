const TRANSPORT_ERROR =
  /cloudflare|connection|dns lookup|econn|enotfound|fetch failed|network|request timeout|socket|temporar|timed? ?out|http 429|http 5\d\d/i;

const DETERMINISTIC_ROUTE_ERROR =
  /cap exceeded|eab: (invalid route|route discontinuity|route output mismatch|route source mismatch|zero route)|exchange rate is unavailable|invalid action|invalid .*factory|invalid .*pair|invalid .*pool|no executable route|no route found|no step output|not configured|paused|price is unavailable|route metadata is unavailable|route quote does not satisfy|slippage|tr:|unapproved .*vault|unsupported/i;

export const isTransportRouteError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  if (TRANSPORT_ERROR.test(message)) return true;
  return !DETERMINISTIC_ROUTE_ERROR.test(message);
};
