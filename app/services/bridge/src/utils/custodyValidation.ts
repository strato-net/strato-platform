import type { EthCustodyDeposit } from "../types";
import { normalizeAddress, safeToBigInt } from "./utils";

const compareTraceAddress = (left: number[], right: number[]): number => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
};

const isTraceAncestor = (ancestor: number[], descendant: number[]): boolean =>
  ancestor.length < descendant.length &&
  ancestor.every((value, index) => descendant[index] === value);

const uniqueTraces = (traces: any[]): { traces: any[]; error?: Error } => {
  const byPosition = new Map<string, { fingerprint: string; trace: any }>();
  for (const trace of traces) {
    if (!Array.isArray(trace.traceAddress)) {
      return {
        traces: [],
        error: new Error("ETH trace is missing traceAddress ordering"),
      };
    }
    const position = JSON.stringify(trace.traceAddress);
    const fingerprint = JSON.stringify([
      trace.type,
      normalizeAddress(trace.action?.from),
      normalizeAddress(trace.action?.to),
      String(trace.action?.value || "0").toLowerCase(),
      String(trace.action?.input || "").toLowerCase(),
    ]);
    const existing = byPosition.get(position);
    if (existing && existing.fingerprint !== fingerprint) {
      return {
        traces: [],
        error: new Error(`Conflicting ETH traces at ${position}`),
      };
    }
    if (!existing) byPosition.set(position, { fingerprint, trace });
  }
  return {
    traces: [...byPosition.values()]
      .map(({ trace }) => trace)
      .sort((a, b) => compareTraceAddress(a.traceAddress, b.traceAddress)),
  };
};

export const verifyEthTransactionCustody = (
  ethDeposits: EthCustodyDeposit[],
  traces: any[],
  custodyAddress: string,
): Error | null => {
  const normalizedCustody = normalizeAddress(custodyAddress);
  if (ethDeposits.length === 0) return null;
  const uniqueTraceResult = uniqueTraces(traces);
  if (uniqueTraceResult.error) return uniqueTraceResult.error;
  const orderedTraces = uniqueTraceResult.traces.filter((trace) =>
    !trace.error && !uniqueTraceResult.traces.some((ancestor) =>
      ancestor.error && isTraceAncestor(ancestor.traceAddress, trace.traceAddress),
    ),
  );
  const routers = new Set(ethDeposits.map((deposit) => deposit.depositRouter));
  const movements = orderedTraces
    .filter(
      (trace) =>
        trace.type === "call" &&
        routers.has(normalizeAddress(trace.action?.from)) &&
        normalizeAddress(trace.action?.to) === normalizedCustody &&
        safeToBigInt(trace.action?.value || "0") > 0n,
    )
    .map((movement) => {
      const ancestors = orderedTraces.filter(
        (candidate) =>
          candidate.type === "call" &&
          normalizeAddress(candidate.action?.to) ===
            normalizeAddress(movement.action?.from) &&
          isTraceAncestor(candidate.traceAddress, movement.traceAddress),
      );
      const invocation = ancestors.sort(
        (left, right) => right.traceAddress.length - left.traceAddress.length,
      )[0];
      return { movement, invocation };
    })
    .sort((left, right) =>
      compareTraceAddress(
        left.invocation?.traceAddress || left.movement.traceAddress,
        right.invocation?.traceAddress || right.movement.traceAddress,
      ),
    );
  if (movements.length !== ethDeposits.length) {
    return new Error(
      `ETH custody movement count mismatch: expected ${ethDeposits.length}, got ${movements.length}`,
    );
  }
  for (let index = 0; index < ethDeposits.length; index += 1) {
    const deposit = ethDeposits[index];
    const { movement, invocation } = movements[index];
    if (
      !invocation ||
      normalizeAddress(invocation.action?.from) !== deposit.externalSender ||
      normalizeAddress(invocation.action?.to) !== deposit.depositRouter ||
      normalizeAddress(movement.action?.from) !== deposit.depositRouter ||
      safeToBigInt(movement.action?.value || "0") !==
        BigInt(deposit.observedExternalTokenAmount)
    ) {
      return new Error(
        `ETH custody movement does not uniquely match deposit ${deposit.depositId}`,
      );
    }
  }
  return null;
};
