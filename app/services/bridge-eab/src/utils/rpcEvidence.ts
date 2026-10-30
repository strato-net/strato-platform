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

const normalizedCallType = (value: unknown): string | undefined => {
  const type = String(value || "").toLowerCase();
  return ["call", "callcode", "delegatecall", "staticcall"].includes(type)
    ? type
    : undefined;
};

const normalizeQuantity = (value: unknown): unknown => {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    return value;
  }
  return `0x${BigInt(value).toString(16)}`;
};

const compareTraceAddress = (left: number[], right: number[]): number => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
};

const normalizeTrace = (trace: any, traceAddress: number[]): any => {
  if (!trace || typeof trace !== "object") {
    throw new Error("Invalid trace entry");
  }
  const callType = normalizedCallType(trace.action?.callType || trace.type);
  const rawType = String(trace.type || "").toLowerCase();
  const type = callType
    ? "call"
    : rawType === "suicide" || rawType === "selfdestruct"
      ? "selfdestruct"
      : rawType === "create2"
        ? "create"
        : rawType;
  if (!type) throw new Error("Trace entry is missing type");
  const source = trace.action || trace;
  const from = source.from ?? (type === "selfdestruct" ? source.address : undefined);
  const to = source.to ??
    (type === "create" ? trace.result?.address : undefined) ??
    (type === "selfdestruct" ? source.refundAddress : undefined);
  const value = source.value ?? (type === "selfdestruct" ? source.balance : undefined);
  const input = source.input ?? (type === "create" ? source.init : undefined);
  const output = trace.result?.output ?? trace.output ??
    (type === "create" ? trace.result?.code : undefined);
  return {
    type,
    traceAddress,
    ...(trace.error ? { error: "failed" } : {}),
    action: {
      ...(callType ? { callType } : {}),
      ...(from !== undefined ? { from: normalizeHex(from) } : {}),
      ...(to !== undefined ? { to: normalizeHex(to) } : {}),
      ...(value !== undefined ? { value: normalizeQuantity(value) } : {}),
      ...(input !== undefined ? { input: normalizeHex(input) } : {}),
    },
    result: {
      ...(output !== undefined ? { output: normalizeHex(output) } : {}),
    },
  };
};

export const normalizeParityTraces = (traces: unknown): any[] => {
  if (!Array.isArray(traces)) throw new Error("Invalid trace_transaction response");
  return traces.map((trace: any) => {
    if (!Array.isArray(trace?.traceAddress)) {
      throw new Error("Trace entry is missing traceAddress");
    }
    return normalizeTrace(trace, trace.traceAddress);
  }).sort((left, right) => compareTraceAddress(left.traceAddress, right.traceAddress));
};

export const normalizeCallTracerResult = (root: unknown): any[] => {
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    throw new Error("Invalid callTracer response");
  }
  const traces: any[] = [];
  const visit = (trace: any, traceAddress: number[]): void => {
    traces.push(normalizeTrace(trace, traceAddress));
    if (trace.calls !== undefined && !Array.isArray(trace.calls)) {
      throw new Error("Invalid callTracer child calls");
    }
    (trace.calls || []).forEach((child: any, index: number) =>
      visit(child, [...traceAddress, index]),
    );
  };
  visit(root, []);
  return traces;
};

export const traceFingerprint = (traces: any[]): string => JSON.stringify(traces.map((trace) => ({
  type: trace.type, traceAddress: trace.traceAddress, error: trace.error || null,
  action: Object.fromEntries(Object.entries(trace.action || {}).sort().map(([key, value]) => [key, normalizeHex(value)])),
  result: Object.fromEntries(Object.entries(trace.result || {}).sort().map(([key, value]) => [key, normalizeHex(value)])),
})));
