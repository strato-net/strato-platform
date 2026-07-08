import { WasConfig } from "./types";

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return value === "true";
};

const parseOptionalPositiveInteger = (
  value: string | undefined,
): number | undefined => {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseAddressList = (value: string | undefined): string[] =>
  (value || "")
    .split(",")
    .map((address) => address.trim().toLowerCase().replace(/^0x/, ""))
    .filter(Boolean);

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not defined`);
  }
  return value;
};

export const loadConfig = (): WasConfig => ({
  nodeUrl: requireEnv("NODE_URL").replace(/\/$/, ""),
  mercataBridge: requireEnv("MERCATA_BRIDGE").toLowerCase().replace(/^0x/, ""),
  stratoNativeBridge: requireEnv("STRATO_NATIVE_BRIDGE")
    .toLowerCase()
    .replace(/^0x/, ""),
  port: parsePositiveInteger(process.env.WAS_PORT, 3002),
  pollIntervalMs: parsePositiveInteger(
    process.env.WAS_POLL_INTERVAL_MS,
    3_600_000,
  ),
  traceMaxDepth: parseOptionalPositiveInteger(process.env.WAS_TRACE_MAX_DEPTH),
  trustAnchorBlock: parsePositiveInteger(
    process.env.WAS_TRUST_ANCHOR_BLOCK,
    75_000,
  ),
  eventSnapshotDir: process.env.WAS_EVENT_SNAPSHOT_DIR,
  auditTraceDumpDir: process.env.WAS_AUDIT_TRACE_DUMP_DIR,
  traceTrustedProtocolAddresses: parseAddressList(
    process.env.WAS_TRUSTED_PROTOCOL_ADDRESSES,
  ),
  traceSkipAddresses: parseAddressList(process.env.WAS_TRACE_SKIP_ADDRESSES),
  includeTerminalWithdrawals: parseBoolean(
    process.env.WAS_INCLUDE_TERMINAL_WITHDRAWALS,
    true,
  ),
  oauth: {
    discoveryUrl: process.env.OAUTH_DISCOVERY_URL,
    clientId: process.env.OAUTH_CLIENT_ID,
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
  },
});
