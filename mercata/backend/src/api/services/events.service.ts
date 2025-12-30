import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import type {
  EventData,
  EventResponse,
  ContractInfoResponse,
} from "@mercata/shared-types";

// Activity types (also exported from shared-types)
export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  description: string;
  fromAddress: string;
  fromLabel?: string;
  toLabel?: string;
  amount: string;
  amountToken: string;
  isPositive: boolean;
  timestamp: string;
  txHash?: string;
  eventName: string;
  contractName: string;
  attributes: Record<string, string>;
}

export interface ActivitiesResponse {
  activities: ActivityItem[];
  total: number;
}

// Activity event mapping
const ACTIVITY_EVENTS = [
  "Deposited", "DepositedOnBehalfOf", "Withdrawn", "Borrowed", "Repaid",
  "USDSTMinted", "USDSTBurned", "Swap", "AddLiquidity", "RemoveLiquidity",
  "DepositCompleted", "WithdrawalRequested", "WithdrawalCompleted",
  "SuppliedCollateral", "WithdrawnCollateral"
];

const EVENT_TYPE_MAP: Record<string, string> = {
  Deposited: "deposit", DepositedOnBehalfOf: "deposit",
  Withdrawn: "withdraw", Repaid: "borrow",
  Borrowed: "borrow", SuppliedCollateral: "borrow", WithdrawnCollateral: "borrow",
  USDSTMinted: "cdp", USDSTBurned: "cdp",
  Swap: "swap", AddLiquidity: "swap", RemoveLiquidity: "swap",
  DepositCompleted: "bridge", WithdrawalRequested: "bridge", WithdrawalCompleted: "bridge",
};

const buildActivityTitle = (eventName: string, _attrs: Record<string, string>): string => {
  switch (eventName) {
    case "Deposited": case "DepositedOnBehalfOf": return "Deposit to Savings";
    case "Withdrawn": return "Withdraw from Savings";
    case "Borrowed": return "Borrow USDST";
    case "Repaid": return "Repay Loan";
    case "SuppliedCollateral": return "Supply Collateral";
    case "WithdrawnCollateral": return "Withdraw Collateral";
    case "USDSTMinted": return "CDP Mint";
    case "USDSTBurned": return "CDP Repay";
    case "Swap": return "Swap";
    case "AddLiquidity": return "Add Liquidity";
    case "RemoveLiquidity": return "Remove Liquidity";
    case "DepositCompleted": return "Bridge In";
    case "WithdrawalRequested": case "WithdrawalCompleted": return "Bridge Out";
    default: return eventName;
  }
};

export const getEvents = async (
  accessToken: string,
  query: Record<string, string> = {}
): Promise<EventResponse> => {
  const storageSelect = "storage!inner(contract!inner(contract_name))";
  const params = {
    ...query,
    order: query.order || "block_timestamp.desc",
    select: `*,${storageSelect}`,
  };

  const hasStorageFilter = !!query["storage.contract.contract_name"];
  const { limit: _limit, offset: _offset, order: _order, ...countQuery } = query;
  const countParams = {
    ...countQuery,
    select: hasStorageFilter ? `${storageSelect},count()` : "count()",
  };

  const [countResponse, eventsResponse] = await Promise.all([
    cirrus.get(accessToken, `/${constants.Event}`, {
      params: countParams,
    }),
    cirrus.get(accessToken, `/${constants.Event}`, { params }),
  ]);

  const total = countResponse.data?.[0]?.count || 0;
  const data = eventsResponse.data;

  const events = (data || []).map((event: any) => {
    const { storage, ...eventWithoutStorage } = event;
    return {
      ...eventWithoutStorage,
      contract_name: event.storage?.contract?.[0]?.contract_name || "",
    };
  });

  return {
    events,
    total: total,
  };
};

export const getContractInfo = async (
  accessToken: string
): Promise<ContractInfoResponse> => {
  const contracts = new Map<string, Set<string>>();

  const { data } = await cirrus.get(accessToken, `/${constants.Event}`, {
    params: {
      select:
        "event_name,event_name.count(),storage!inner(contract!inner(contract_name))",
      "storage.contract.contract_name": "neq.Proxy",
    },
  });

  (data as EventData[])?.forEach((event) => {
    if (!event?.event_name || !event?.storage?.contract?.[0]?.contract_name)
      return;

    if (!contracts.has(event.storage.contract?.[0]?.contract_name)) {
      contracts.set(event.storage.contract?.[0]?.contract_name, new Set());
    }
    contracts
      .get(event.storage.contract?.[0]?.contract_name)!
      .add(event.event_name);
  });

  return {
    contracts: Array.from(contracts.entries())
      .map(([name, events]) => ({
        name,
        events: [...events].sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};

export interface ActivitiesFilters {
  userAddress?: string;
  type?: string; // deposit, withdraw, borrow, swap, bridge, cdp
  period?: string; // today, week, month, all
  limit?: number;
  offset?: number;
}

export const getActivities = async (
  accessToken: string,
  filters: ActivitiesFilters = {}
): Promise<ActivitiesResponse> => {
  const { userAddress, type, period, limit = 20, offset = 0 } = filters;

  // Build event_name filter based on activity type
  let eventFilter = ACTIVITY_EVENTS;
  if (type && type !== "all") {
    eventFilter = Object.entries(EVENT_TYPE_MAP)
      .filter(([, t]) => t === type)
      .map(([e]) => e);
  }

  // Build time filter
  let timeFilter: string | undefined;
  if (period && period !== "all") {
    const now = new Date();
    let startDate: Date;
    switch (period) {
      case "today":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "week":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(0);
    }
    timeFilter = `gte.${startDate.toISOString()}`;
  }

  const storageSelect = "storage!inner(contract!inner(contract_name))";
  const params: Record<string, string> = {
    select: `*,${storageSelect}`,
    order: "block_timestamp.desc",
    event_name: `in.(${eventFilter.join(",")})`,
    limit: limit.toString(),
    offset: offset.toString(),
  };

  if (userAddress) {
    params.transaction_sender = `eq.${userAddress}`;
  }
  if (timeFilter) {
    params.block_timestamp = timeFilter;
  }

  // Count query
  const countParams: Record<string, string> = {
    select: "count()",
    event_name: params.event_name,
  };
  if (userAddress) countParams.transaction_sender = params.transaction_sender;
  if (timeFilter) countParams.block_timestamp = timeFilter;

  const [countRes, eventsRes] = await Promise.all([
    cirrus.get(accessToken, `/${constants.Event}`, { params: countParams }),
    cirrus.get(accessToken, `/${constants.Event}`, { params }),
  ]);

  const total = countRes.data?.[0]?.count || 0;
  const rawEvents = eventsRes.data || [];

  // Map events to activities
  const activities: ActivityItem[] = rawEvents.map((event: any, idx: number) => {
    const attrs = event.attributes || {};
    const eventName = event.event_name || "";
    const activityType = EVENT_TYPE_MAP[eventName] || "other";
    
    // Determine amount and token from attributes
    const amount = attrs.amount || attrs.amountUSD || attrs.amountIn || attrs.stratoTokenAmount || "0";
    const isPositive = !["Withdrawn", "WithdrawalRequested", "USDSTBurned", "RemoveLiquidity", "WithdrawnCollateral", "Repaid"].includes(eventName);

    return {
      id: `${event.id || idx}`,
      type: activityType,
      title: buildActivityTitle(eventName, attrs),
      description: eventName,
      fromAddress: event.transaction_sender || "",
      amount: amount,
      amountToken: "", // Will be enriched by frontend with token context
      isPositive,
      timestamp: event.block_timestamp || "",
      txHash: event.transaction_hash || "",
      eventName,
      contractName: event.storage?.contract?.[0]?.contract_name || "",
      attributes: attrs,
    };
  });

  return { activities, total };
};
