import axios from "axios";
import { config } from "../config";
import { logError } from "../utils/logger";

// Anonymous PostgREST reads via the edge (GETs on /cirrus/search/ allow
// anonymous access). If Cirrus is ever locked down, add a Bearer token here.
const cirrus = axios.create({
  baseURL: `${config.api.nodeUrl}/cirrus/search`,
  timeout: 60000,
  headers: { Accept: "application/json" },
});

const PREFIX = config.cirrus.contractPrefix;
const ADDRESS_CHUNK = 100;

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const inList = (values: string[]): string =>
  `in.(${values.map((v) => `"${v}"`).join(",")})`;

// Cirrus timestamps are naive UTC strings; normalize to epoch millis.
export const parseCirrusTimestamp = (raw: string): number => {
  if (!raw) return NaN;
  const withZone = /Z$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
  return new Date(withZone).getTime();
};

export const isOnChainAdmin = async (address: string): Promise<boolean> => {
  const { data } = await cirrus.get(`/${config.cirrus.adminRegistryTable}`, {
    params: { key: `eq.${address}`, select: "key,value", limit: "1" },
  });
  if (!Array.isArray(data) || data.length === 0) return false;
  return Number(data[0].value) > 0;
};

export interface BridgeInEvent {
  bridge: "MercataBridge" | "StratoNativeBridge";
  externalSender: string;
  stratoRecipient: string;
  stratoToken: string;
  stratoTokenAmount: string; // raw 1e18-scaled integer string
  externalTxHash: string | null;
  txHash: string | null;
  timestampMs: number;
  eventKey: string;
}

const DEPOSIT_TABLES: { bridge: BridgeInEvent["bridge"]; table: string }[] = [
  { bridge: "MercataBridge", table: `${PREFIX}MercataBridge-DepositCompleted` },
  { bridge: "StratoNativeBridge", table: `${PREFIX}StratoNativeBridge-NativeDepositCompleted` },
];

const DEPOSIT_SELECT =
  "id,externalSender,externalTxHash,stratoRecipient,stratoToken,stratoTokenAmount::text,block_timestamp,transaction_hash";

const fetchDepositRows = async (
  table: string,
  column: "stratoRecipient" | "externalSender",
  addresses: string[]
): Promise<any[]> => {
  const rows: any[] = [];
  for (const group of chunk(addresses, ADDRESS_CHUNK)) {
    try {
      const { data } = await cirrus.get(`/${table}`, {
        params: {
          [column]: inList(group),
          select: DEPOSIT_SELECT,
          order: "block_timestamp.asc",
          limit: "10000",
        },
      });
      if (Array.isArray(data)) rows.push(...data);
    } catch (error) {
      // A missing table (bridge not deployed on this network) is not fatal
      logError("Cirrus", error, { operation: "fetchDepositRows", table, column });
    }
  }
  return rows;
};

// Completed bridge-ins for any of the given addresses. Each row carries BOTH
// the external sender and the STRATO recipient, so a wallet tracked by either
// identifier is attributable.
export const fetchBridgeIns = async (
  stratoAddresses: string[],
  externalAddresses: string[]
): Promise<BridgeInEvent[]> => {
  const seen = new Set<string>();
  const events: BridgeInEvent[] = [];
  for (const { bridge, table } of DEPOSIT_TABLES) {
    const rows = [
      ...(stratoAddresses.length
        ? await fetchDepositRows(table, "stratoRecipient", stratoAddresses)
        : []),
      ...(externalAddresses.length
        ? await fetchDepositRows(table, "externalSender", externalAddresses)
        : []),
    ];
    for (const row of rows) {
      const eventKey = `${table}:${row.id ?? `${row.transaction_hash}:${row.stratoRecipient}:${row.stratoTokenAmount}`}`;
      if (seen.has(eventKey)) continue;
      seen.add(eventKey);
      events.push({
        bridge,
        externalSender: (row.externalSender || "").toLowerCase(),
        stratoRecipient: (row.stratoRecipient || "").toLowerCase(),
        stratoToken: (row.stratoToken || "").toLowerCase(),
        stratoTokenAmount: row.stratoTokenAmount ?? "0",
        externalTxHash: row.externalTxHash ?? null,
        txHash: row.transaction_hash ?? null,
        timestampMs: parseCirrusTimestamp(row.block_timestamp),
        eventKey,
      });
    }
  }
  return events;
};

export interface ActivityEvent {
  contractName: string;
  eventName: string;
  userAddress: string;
  timestampMs: number;
  attributes: Record<string, string>;
  eventKey: string;
}

// Contract:Event pairs that count as "meaningful STRATO actions", with the
// attribute holding the acting user's address (mirrors the marketplace
// backend's activityFilterConfigs).
const ACTIVITY_PAIRS: { contract: string; event: string; userAttr: string }[] = [
  { contract: "Pool", event: "Swap", userAttr: "sender" },
  { contract: "MetalForge", event: "MetalMinted", userAttr: "buyer" },
  { contract: "Vault", event: "Deposited", userAttr: "user" },
  { contract: "LendingPool", event: "Deposited", userAttr: "user" },
  { contract: "LendingPool", event: "Borrowed", userAttr: "user" },
  { contract: "CDPEngine", event: "USDSTMinted", userAttr: "owner" },
  { contract: "StratoStaking", event: "Staked", userAttr: "user" },
];

// Post-bridge activity for the given STRATO addresses, from the unified event
// table (note: it has no transaction_hash column, so activity rows carry none).
export const fetchActivityEvents = async (stratoAddresses: string[]): Promise<ActivityEvent[]> => {
  if (stratoAddresses.length === 0) return [];
  const events: ActivityEvent[] = [];
  for (const pair of ACTIVITY_PAIRS) {
    for (const group of chunk(stratoAddresses, ADDRESS_CHUNK)) {
      try {
        const { data } = await cirrus.get("/event", {
          params: {
            select:
              "id,address,block_timestamp,event_name,attributes,storage!inner(contract!inner(contract_name))",
            "storage.contract.contract_name": `eq.${pair.contract}`,
            event_name: `eq.${pair.event}`,
            [`attributes->>${pair.userAttr}`]: inList(group),
            order: "block_timestamp.asc",
            limit: "5000",
          },
        });
        if (!Array.isArray(data)) continue;
        for (const row of data) {
          events.push({
            contractName: pair.contract,
            eventName: pair.event,
            userAddress: (row.attributes?.[pair.userAttr] || "").toLowerCase(),
            timestampMs: parseCirrusTimestamp(row.block_timestamp),
            attributes: row.attributes ?? {},
            eventKey: `event:${row.id}`,
          });
        }
      } catch (error) {
        logError("Cirrus", error, {
          operation: "fetchActivityEvents",
          contract: pair.contract,
          event: pair.event,
        });
      }
    }
  }
  return events;
};

// Token address (lowercase, no 0x) -> symbol
export const fetchTokenSymbols = async (tokenAddresses: string[]): Promise<Map<string, string>> => {
  const symbols = new Map<string, string>();
  if (tokenAddresses.length === 0) return symbols;
  for (const group of chunk(tokenAddresses, ADDRESS_CHUNK)) {
    try {
      const { data } = await cirrus.get(`/${PREFIX}Token`, {
        params: { address: inList(group), select: "address,_symbol" },
      });
      if (!Array.isArray(data)) continue;
      for (const row of data) {
        if (row.address && row._symbol) symbols.set(row.address.toLowerCase(), row._symbol);
      }
    } catch (error) {
      logError("Cirrus", error, { operation: "fetchTokenSymbols" });
    }
  }
  return symbols;
};

// Token address -> USD price (both amounts and prices are 1e18-scaled on chain)
export const fetchOraclePricesUsd = async (): Promise<Map<string, number>> => {
  const prices = new Map<string, number>();
  try {
    const { data } = await cirrus.get(`/${PREFIX}PriceOracle-prices`, {
      params: { select: "asset:key,price:value::text" },
    });
    if (Array.isArray(data)) {
      for (const row of data) {
        if (!row.asset || !row.price) continue;
        try {
          prices.set(row.asset.toLowerCase(), Number(BigInt(row.price)) / 1e18);
        } catch {
          // non-integer price value; skip
        }
      }
    }
  } catch (error) {
    logError("Cirrus", error, { operation: "fetchOraclePricesUsd" });
  }
  return prices;
};
