// A Safe transaction's `origin` tags the bridge withdrawal it pays, so the Safe itself can say
// whether a withdrawal already has a payout. The Safe Transaction Service caps origin at 200
// characters, parses it as JSON, and returns it as JSON text.
const MAX_ORIGIN_LENGTH = 200;

const bridgeKey = (bridgeAddress: string) =>
  bridgeAddress.trim().replace(/^0x/i, "").toLowerCase();

export const buildWithdrawalOrigin = (bridgeAddress: string, withdrawalId: string): string => {
  const origin = JSON.stringify({
    name: `STRATO bridge withdrawal ${withdrawalId}`,
    bridge: bridgeKey(bridgeAddress),
    withdrawalId: String(withdrawalId),
  });
  if (origin.length > MAX_ORIGIN_LENGTH) {
    throw new Error(`Safe origin for withdrawal ${withdrawalId} exceeds ${MAX_ORIGIN_LENGTH} characters`);
  }
  return origin;
};

// The withdrawal a Safe transaction pays, or null when this bridge did not tag it
export const parseWithdrawalOrigin = (bridgeAddress: string, origin: unknown): string | null => {
  let value = origin;
  // Tolerate the service returning the JSON text encoded one extra time
  for (let depth = 0; depth < 2 && typeof value === "string"; depth++) {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;

  const { bridge, withdrawalId } = value as Record<string, unknown>;
  if (typeof bridge !== "string" || bridgeKey(bridge) !== bridgeKey(bridgeAddress)) return null;
  return typeof withdrawalId === "string" && withdrawalId !== "" ? withdrawalId : null;
};
