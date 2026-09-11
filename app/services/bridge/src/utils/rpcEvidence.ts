const normalizeHex = (value: unknown): unknown =>
  typeof value === "string" && value.toLowerCase().startsWith("0x")
    ? value.toLowerCase()
    : value;

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

