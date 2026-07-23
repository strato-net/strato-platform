import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getOraclePrices } from "./oracle.service";

// Chain-activity lookup for the tracking-links dashboard. The tracking
// service (standalone, no node access) owns the offchain data; the UI calls
// this endpoint with the wallet addresses it learned there and joins the two
// datasets client-side. Everything returned here is public Cirrus data.

export type TrackingActivityCategory =
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

export interface TrackingChainEvent {
  eventKey: string;
  category: TrackingActivityCategory;
  contractName: string;
  eventName: string;
  address: string;
  at: string;
}

export interface TrackingBridgeIn {
  eventKey: string;
  externalSender: string;
  stratoRecipient: string;
  asset: string;
  amount: string;
  amountUsd: number | null;
  txHash: string | null;
  at: string;
}

export interface TrackingActivityResponse {
  events: TrackingChainEvent[];
  bridgeIns: TrackingBridgeIn[];
}

const ADDRESS_RE = /^[0-9a-f]{40}$/;
export const MAX_TRACKING_ADDRESSES = 200;
const ADDRESS_CHUNK = 100;

export const normalizeTrackingAddresses = (raw: unknown): string[] | null => {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TRACKING_ADDRESSES) return null;
  const normalized = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") return null;
    const address = entry.trim().toLowerCase().replace(/^0x/, "");
    if (!ADDRESS_RE.test(address)) return null;
    normalized.add(address);
  }
  return [...normalized];
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const inList = (values: string[]): string => `in.(${values.map((v) => `"${v}"`).join(",")})`;

// Cirrus timestamps are naive UTC strings
const toIso = (raw: string): string | null => {
  if (!raw) return null;
  const withZone = /Z$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
  const ms = new Date(withZone).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

// Contract:Event pairs mirrored from ACTIVITY_FILTER_CONFIGS, grouped into
// dashboard categories. Contract names are bare (the event-table join filters
// on contract_name); or-attribute pairs appear once per attribute with
// distinct categories. bridge_in comes from the dedicated deposit tables.
const ACTIVITY_PAIRS: {
  contract: string;
  event: string;
  userAttr: string;
  category: TrackingActivityCategory;
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

const DEPOSIT_TABLES = [
  `${constants.MercataBridge}-DepositCompleted`,
  `${constants.StratoNativeBridge}-NativeDepositCompleted`,
];

const DEPOSIT_SELECT =
  "id,externalSender,externalTxHash,stratoRecipient,stratoToken,stratoTokenAmount::text,block_timestamp,transaction_hash";

const tokenAmount = (raw: string): number => {
  try {
    return Number(BigInt(raw)) / 1e18;
  } catch {
    return 0;
  }
};

const fetchDepositRows = async (
  accessToken: string,
  table: string,
  column: "stratoRecipient" | "externalSender",
  addresses: string[]
): Promise<any[]> => {
  const rows: any[] = [];
  for (const group of chunk(addresses, ADDRESS_CHUNK)) {
    try {
      const { data } = await cirrus.get(accessToken, `/${table}`, {
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
      console.warn(`[Tracking] deposit query failed for ${table}/${column}:`, error);
    }
  }
  return rows;
};

const fetchTokenSymbols = async (
  accessToken: string,
  tokenAddresses: string[]
): Promise<Map<string, string>> => {
  const symbols = new Map<string, string>();
  if (tokenAddresses.length === 0) return symbols;
  for (const group of chunk(tokenAddresses, ADDRESS_CHUNK)) {
    try {
      const { data } = await cirrus.get(accessToken, `/${constants.Token}`, {
        params: { address: inList(group), select: "address,_symbol" },
      });
      if (!Array.isArray(data)) continue;
      for (const row of data) {
        if (row.address && row._symbol) symbols.set(row.address.toLowerCase(), row._symbol);
      }
    } catch (error) {
      console.warn("[Tracking] token symbol query failed:", error);
    }
  }
  return symbols;
};

export const getTrackingActivity = async (
  accessToken: string,
  addresses: string[]
): Promise<TrackingActivityResponse> => {
  // Bridge-ins: each completed deposit carries BOTH the external sender and
  // the STRATO recipient, so query by either identifier and dedupe.
  const seenDeposits = new Set<string>();
  const rawDeposits: { table: string; row: any }[] = [];
  for (const table of DEPOSIT_TABLES) {
    for (const column of ["stratoRecipient", "externalSender"] as const) {
      const rows = await fetchDepositRows(accessToken, table, column, addresses);
      for (const row of rows) {
        const eventKey = `${table}:${row.id ?? `${row.transaction_hash}:${row.stratoRecipient}:${row.stratoTokenAmount}`}`;
        if (seenDeposits.has(eventKey)) continue;
        seenDeposits.add(eventKey);
        rawDeposits.push({ table, row });
      }
    }
  }

  const tokenAddresses = [
    ...new Set(
      rawDeposits.map(({ row }) => (row.stratoToken || "").toLowerCase()).filter(Boolean)
    ),
  ];
  const [symbols, prices] = await Promise.all([
    fetchTokenSymbols(accessToken, tokenAddresses),
    tokenAddresses.length
      ? getOraclePrices(accessToken)
      : Promise.resolve(new Map<string, string>()),
  ]);

  const bridgeIns: TrackingBridgeIn[] = [];
  for (const { table, row } of rawDeposits) {
    const at = toIso(row.block_timestamp);
    if (!at) continue;
    const token = (row.stratoToken || "").toLowerCase();
    const priceStr = prices.get(token);
    let amountUsd: number | null = null;
    if (priceStr) {
      try {
        amountUsd = tokenAmount(row.stratoTokenAmount ?? "0") * (Number(BigInt(priceStr)) / 1e18);
      } catch {
        amountUsd = null;
      }
    }
    bridgeIns.push({
      eventKey: `${table}:${row.id ?? `${row.transaction_hash}:${row.stratoRecipient}:${row.stratoTokenAmount}`}`,
      externalSender: (row.externalSender || "").toLowerCase(),
      stratoRecipient: (row.stratoRecipient || "").toLowerCase(),
      asset: symbols.get(token) ?? token.slice(0, 8),
      amount: tokenAmount(row.stratoTokenAmount ?? "0").toLocaleString("en-US", {
        maximumFractionDigits: 6,
      }),
      amountUsd,
      txHash: row.transaction_hash ?? null,
      at,
    });
  }

  // Categorized activity from the unified event table (note: it has no
  // transaction_hash column, so these rows carry none).
  const events: TrackingChainEvent[] = [];
  for (const pair of ACTIVITY_PAIRS) {
    for (const group of chunk(addresses, ADDRESS_CHUNK)) {
      try {
        const { data } = await cirrus.get(accessToken, `/${constants.Event}`, {
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
          const at = toIso(row.block_timestamp);
          if (!at) continue;
          events.push({
            // Category in the key so a Transfer counted as sent-by-A and
            // received-by-B stays two distinct facts
            eventKey: `event:${row.id}:${pair.category}`,
            category: pair.category,
            contractName: pair.contract,
            eventName: pair.event,
            address: (row.attributes?.[pair.userAttr] || "").toLowerCase(),
            at,
          });
        }
      } catch (error) {
        console.warn(
          `[Tracking] activity query failed for ${pair.contract}:${pair.event}:`,
          error
        );
      }
    }
  }

  return { events, bridgeIns };
};
