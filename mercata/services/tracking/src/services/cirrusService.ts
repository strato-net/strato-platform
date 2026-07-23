import axios from "axios";
import { config } from "../config";
import { logError } from "../utils/logger";

// Anonymous PostgREST reads via the node's edge (GETs on /cirrus/search/ allow
// anonymous access). If Cirrus is ever locked down, add a Bearer token here.
const cirrus = axios.create({
  baseURL: `${config.api.nodeUrl}/cirrus/search`,
  timeout: 60000,
  headers: { Accept: "application/json" },
});

const PREFIX = "BlockApps-";
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
      const timestampMs = parseCirrusTimestamp(row.block_timestamp);
      if (!Number.isFinite(timestampMs)) {
        logError("Cirrus", `unparseable block_timestamp: ${JSON.stringify(row.block_timestamp)}`, {
          operation: "fetchBridgeIns",
          table,
        });
        continue;
      }
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
        timestampMs,
        eventKey,
      });
    }
  }
  return events;
};

export type ActivityCategory =
  | "bridge_in"
  | "bridge_out"
  | "swap"
  | "liquidity_add"
  | "liquidity_remove"
  | "cdp_borrow"
  | "cdp_repay"
  | "savings_deposit"
  | "savings_withdraw"
  | "transfer_sent"
  | "transfer_received"
  | "metal_purchase"
  | "vault_deposit"
  | "vault_withdraw"
  | "lending_deposit"
  | "lending_borrow"
  | "staking"
  | "rewards";

export interface ActivityEvent {
  contractName: string;
  eventName: string;
  category: ActivityCategory;
  userAddress: string;
  timestampMs: number;
  attributes: Record<string, string>;
  eventKey: string;
}

// Contract:Event pairs that count as user activity, with the attribute holding
// the acting user's address and a dashboard category. Mirrors the marketplace
// backend's activityFilterConfigs; or-attribute pairs (Token:Transfer) appear
// as one entry per attribute with distinct categories. bridge_in comes from
// the dedicated DepositCompleted tables, not this list.
const ACTIVITY_PAIRS: {
  contract: string;
  event: string;
  userAttr: string;
  category: ActivityCategory;
}[] = [
  { contract: "MercataBridge", event: "WithdrawalRequested", userAttr: "user", category: "bridge_out" },
  { contract: "StratoNativeBridge", event: "NativeWithdrawalRequested", userAttr: "stratoSender", category: "bridge_out" },
  { contract: "Pool", event: "Swap", userAttr: "sender", category: "swap" },
  { contract: "Pool", event: "AddLiquidity", userAttr: "provider", category: "liquidity_add" },
  { contract: "Pool", event: "RemoveLiquidity", userAttr: "provider", category: "liquidity_remove" },
  { contract: "CDPEngine", event: "USDSTMinted", userAttr: "owner", category: "cdp_borrow" },
  { contract: "CDPEngine", event: "USDSTBurned", userAttr: "owner", category: "cdp_repay" },
  { contract: "SaveUSDSTVault", event: "Deposit", userAttr: "owner", category: "savings_deposit" },
  { contract: "SaveUSDSTVault", event: "Withdraw", userAttr: "owner", category: "savings_withdraw" },
  { contract: "Token", event: "Transfer", userAttr: "from", category: "transfer_sent" },
  { contract: "Token", event: "Transfer", userAttr: "to", category: "transfer_received" },
  { contract: "MetalForge", event: "MetalMinted", userAttr: "buyer", category: "metal_purchase" },
  { contract: "Vault", event: "Deposited", userAttr: "user", category: "vault_deposit" },
  { contract: "Vault", event: "Withdrawn", userAttr: "user", category: "vault_withdraw" },
  { contract: "LendingPool", event: "Deposited", userAttr: "user", category: "lending_deposit" },
  { contract: "LendingPool", event: "Borrowed", userAttr: "user", category: "lending_borrow" },
  { contract: "StratoStaking", event: "Staked", userAttr: "user", category: "staking" },
  { contract: "Rewards", event: "RewardsClaimed", userAttr: "user", category: "rewards" },
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
          const timestampMs = parseCirrusTimestamp(row.block_timestamp);
          if (!Number.isFinite(timestampMs)) continue; // unparseable timestamp: skip row
          events.push({
            contractName: pair.contract,
            eventName: pair.event,
            category: pair.category,
            userAddress: (row.attributes?.[pair.userAttr] || "").toLowerCase(),
            timestampMs,
            attributes: row.attributes ?? {},
            // Category in the key so a Transfer counted as sent-by-A and
            // received-by-B stays two distinct facts
            eventKey: `event:${row.id}:${pair.category}`,
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
