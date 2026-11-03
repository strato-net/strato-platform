export type Severity = "critical" | "high" | "info";

export const SEVERITY_ICON: Record<Severity, string> = { critical: "🔴", high: "🟠", info: "🟡" };

/** AdminRegistry system contract — governance votes, admin set, whitelist */
export const ADMIN_REGISTRY = "000000000000000000000000000000000000100c";

/** MercataBridge system contract — wrap/mint bridge with Safe custody */
export const MERCATA_BRIDGE = "0000000000000000000000000000000000001008";

/** default price oracle system contract */
export const PRICE_ORACLE = "0000000000000000000000000000000000001002";

/** Block-range watchers stop catching up after this long so one long backlog never
 *  delays the event scan; they continue from their cursor next cycle. */
export const CATCH_UP_MS = 20_000;

/** names shown in alerts for the external chains the bridges serve */
export const CHAIN_NAMES: Record<string, string> = {
  "1": "Ethereum",
  "8453": "Base",
  "4663": "Robinhood",
  "59144": "Linea",
  "999": "HyperEVM",
  "11155111": "Sepolia",
  "84532": "Base Sepolia",
  "46630": "Robinhood Testnet",
};

/** Cirrus writes the zero address as either "0" or 40 zeros */
export const isZeroAddress = (a?: string) => /^0+$/.test(a || "0");

export interface Config {
  cirrusBase: string;
  stratoApiBase: string;
  pollIntervalSeconds: number;
  pageSize: number;
  healthPort: number;
  stateFile: string;
  /** executor -> functions it may run through AdminRegistry without an alert */
  knownExecutors: Record<string, Set<string>>;
  /** a single governed mint at or above this % of the token's supply raises a high alert */
  mintAlertPct: number;
  /** failed transactions from one sender within one cycle that raise a high alert */
  failBurst: number;
  /** automation accounts whose retries never count as a failure burst (KNOWN_EXECUTORS are included) */
  failBurstIgnore: Set<string>;
  proxySnapshotSeconds: number;
  /** a governed token's supply growing by at least this % between snapshots raises a high alert */
  supplyJumpPct: number;
  supplySnapshotSeconds: number;
  /** a bridge-out worth more than this many USD raises a critical alert */
  bridgeOutAlertUsd: number;
  /** STRATO side of the native bridge; RepresentationMinted is checked against its withdrawals */
  stratoNativeBridge?: string;
  /** external chains whose bridge contracts are watched; logChunk = blocks per eth_getLogs request */
  evmChains: { chainId: string; rpcUrl: string; bridges: string[]; logChunk: number }[];
  evmConfirmations: number;
  slack?: { token: string; channelId: string; infoChannelId?: string };
}

const required = (name: string): string => {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
};

const num = (name: string, dflt: number): number => {
  const v = (process.env[name] || "").trim();
  if (!v) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number (got "${v}")`);
  return n;
};

const ADDR = /^[0-9a-f]{40}$/;
export const normalize = (a: string) => a.trim().toLowerCase().replace(/^0x/, "");

/** "<key>=<v>,<v>; <key2>=<v>" -> [[key, [v, v]], ...] */
const parseList = (name: string): [string, string[]][] =>
  (process.env[name] || "")
    .split(";")
    .filter((e) => e.trim())
    .map((entry) => {
      const [key, valuesStr] = entry.split("=").map((s) => s.trim());
      const values = (valuesStr || "").split(",").map((v) => v.trim()).filter(Boolean);
      if (!key || values.length === 0) throw new Error(`${name} entry "${entry.trim()}" must be <key>=<value>,<value>`);
      return [key, values];
    });

const address = (name: string, a: string): string => {
  const n = normalize(a);
  if (!ADDR.test(n)) throw new Error(`${name}: "${a}" is not a valid address`);
  return n;
};

export function loadConfig(): Config {
  const nodeUrl = required("NODE_URL").replace(/\/+$/, "");

  // KNOWN_EXECUTORS="<executor>=<func>,<func>; <executor2>=<func>"
  const knownExecutors: Record<string, Set<string>> = {};
  for (const [executor, funcs] of parseList("KNOWN_EXECUTORS"))
    knownExecutors[address("KNOWN_EXECUTORS", executor)] = new Set(funcs);

  // EVM_BRIDGES="<chainId>=<bridge>,<bridge>; <chainId2>=<bridge>" + CHAIN_<chainId>_RPC_URL
  // (+ optional CHAIN_<chainId>_LOG_CHUNK for RPCs with a smaller eth_getLogs range)
  const evmChains = parseList("EVM_BRIDGES").map(([chainId, bridges]) => ({
    chainId,
    rpcUrl: required(`CHAIN_${chainId}_RPC_URL`),
    bridges: bridges.map((b) => address("EVM_BRIDGES", b)),
    logChunk: num(`CHAIN_${chainId}_LOG_CHUNK`, num("EVM_LOG_CHUNK", 2000)),
  }));
  // FAIL_BURST_IGNORE="<account>,<account>"
  const failBurstIgnore = new Set([
    ...Object.keys(knownExecutors),
    ...(process.env.FAIL_BURST_IGNORE || "").split(",").filter((a) => a.trim()).map((a) => address("FAIL_BURST_IGNORE", a)),
  ]);

  const stratoNativeBridge = process.env.STRATO_NATIVE_BRIDGE
    ? address("STRATO_NATIVE_BRIDGE", process.env.STRATO_NATIVE_BRIDGE)
    : undefined;
  if (evmChains.length && !stratoNativeBridge)
    throw new Error("STRATO_NATIVE_BRIDGE is required when EVM_BRIDGES is set");

  const slack =
    process.env.SLACK_TOKEN && process.env.SLACK_CHANNEL_ID
      ? {
          token: process.env.SLACK_TOKEN.trim(),
          channelId: process.env.SLACK_CHANNEL_ID.trim(),
          infoChannelId: process.env.SLACK_INFO_CHANNEL_ID?.trim() || undefined,
        }
      : undefined;

  return {
    cirrusBase: `${nodeUrl}/cirrus/search`,
    stratoApiBase: `${nodeUrl}/strato-api/eth/v1.2`,
    pollIntervalSeconds: num("POLL_INTERVAL_SECONDS", 30),
    pageSize: num("PAGE_SIZE", 1000),
    healthPort: num("HEALTH_PORT", 3008),
    stateFile: process.env.STATE_FILE || ".state.json",
    knownExecutors,
    mintAlertPct: num("MINT_ALERT_PCT", 5),
    failBurst: num("FAIL_BURST", 20),
    failBurstIgnore,
    proxySnapshotSeconds: num("PROXY_SNAPSHOT_SECONDS", 300),
    supplyJumpPct: num("SUPPLY_JUMP_PCT", 10),
    supplySnapshotSeconds: num("SUPPLY_SNAPSHOT_SECONDS", 3600),
    bridgeOutAlertUsd: num("BRIDGE_OUT_ALERT_USD", 5000),
    stratoNativeBridge,
    evmChains,
    evmConfirmations: num("EVM_CONFIRMATIONS", 2),
    slack,
  };
}
