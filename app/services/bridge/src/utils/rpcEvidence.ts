const normalizeHex = (value: unknown): unknown =>
  typeof value === "string" && value.toLowerCase().startsWith("0x")
    ? value.toLowerCase()
    : value;

export const sanitizeRpcError = (error: unknown, rpcUrl: string): string => {
  const endpoint = new URL(rpcUrl);
  let message = error instanceof Error ? error.message : String(error);
  const sensitive = [rpcUrl, endpoint.username, endpoint.password,
    ...endpoint.pathname.split("/"), ...endpoint.searchParams.values()];
  for (const value of sensitive.filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(value).join("[redacted]");
    try {
      message = message.split(decodeURIComponent(value)).join("[redacted]");
    } catch { /* Keep malformed URL components redacted as received. */ }
  }
  return message.replace(/https?:\/\/[^\s"']+/gi, "[redacted URL]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/[\r\n\t]/g, " ").slice(0, 240);
};

export const receiptFingerprint = (receipt: any): string =>
  JSON.stringify({
    transactionHash: normalizeHex(receipt?.transactionHash),
    blockHash: normalizeHex(receipt?.blockHash),
    blockNumber: normalizeHex(receipt?.blockNumber),
    status: normalizeHex(receipt?.status),
    to: normalizeHex(receipt?.to),
    logs: (receipt?.logs || []).map((log: any) => ({
      address: normalizeHex(log.address),
      topics: (log.topics || []).map(normalizeHex),
      data: normalizeHex(log.data),
      logIndex: normalizeHex(log.logIndex),
    })),
  });

export const traceFingerprint = (traces: any[]): string => JSON.stringify(traces.map((trace) => ({
  type: trace.type, traceAddress: trace.traceAddress, error: trace.error || null,
  action: Object.fromEntries(Object.entries(trace.action || {}).sort().map(([key, value]) => [key, normalizeHex(value)])),
  result: Object.fromEntries(Object.entries(trace.result || {}).sort().map(([key, value]) => [key, normalizeHex(value)])),
})));

