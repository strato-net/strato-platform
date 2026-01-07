import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import type {
  EventData,
  EventResponse,
  ContractInfoResponse,
} from "@mercata/shared-types";
import {
  ACTIVITY_EVENTS,
  EVENT_TYPE_MAP,
  transformEvent,
  extractTokenAddresses,
  ActivityItem,
} from "./activity.helpers";
import { getTokenMetadata } from "../helpers/cirrusHelpers";

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
    cirrus.get(accessToken, `/${constants.Event}`, { params: countParams }),
    cirrus.get(accessToken, `/${constants.Event}`, { params }),
  ]);

  const total = countResponse.data?.[0]?.count || 0;
  const events = (eventsResponse.data || []).map((event: any) => {
    const { storage, ...eventWithoutStorage } = event;
    return {
      ...eventWithoutStorage,
      contract_name: event.storage?.contract?.[0]?.contract_name || "",
    };
  });

  return { events, total };
};

export const getContractInfo = async (
  accessToken: string
): Promise<ContractInfoResponse> => {
  const contracts = new Map<string, Set<string>>();

  const { data } = await cirrus.get(accessToken, `/${constants.Event}`, {
    params: {
      select: "event_name,event_name.count(),storage!inner(contract!inner(contract_name))",
      "storage.contract.contract_name": "neq.Proxy",
    },
  });

  (data as EventData[])?.forEach((event) => {
    if (!event?.event_name || !event?.storage?.contract?.[0]?.contract_name) return;

    const contractName = event.storage.contract[0].contract_name;
    if (!contracts.has(contractName)) {
      contracts.set(contractName, new Set());
    }
    contracts.get(contractName)!.add(event.event_name);
  });

  return {
    contracts: Array.from(contracts.entries())
      .map(([name, events]) => ({ name, events: [...events].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};

// ─────────────── Activities API ───────────────

interface ActivitiesResponse {
  activities: ActivityItem[];
  total: number;
  limit: number;
  offset: number;
}

export const getActivities = async (
  accessToken: string,
  filters: { userAddress?: string; type?: string; limit?: number; offset?: number } = {}
): Promise<ActivitiesResponse> => {
  const { userAddress, type, limit = 50, offset = 0 } = filters;

  const params: Record<string, string> = {
    select: `*,storage!inner(contract!inner(contract_name))`,
    order: "block_timestamp.desc",
    limit: String(limit),
    offset: String(offset),
    event_name: `in.(${ACTIVITY_EVENTS.join(",")})`,
  };

  // Filter by user address
  if (userAddress) {
    params.transaction_sender = `eq.${userAddress}`;
  }

  // Filter by activity type
  if (type && type !== "all") {
    const eventNames = Object.entries(EVENT_TYPE_MAP)
      .filter(([_, t]) => t === type)
      .map(([name]) => name);
    if (eventNames.length > 0) {
      params.event_name = `in.(${eventNames.join(",")})`;
    }
  }

  // Get count and data in parallel
  const { limit: _l, offset: _o, order: _ord, ...countBase } = params;
  const countParams = { ...countBase, select: "count()" };

  const [countRes, dataRes] = await Promise.all([
    cirrus.get(accessToken, `/${constants.Event}`, { params: countParams }),
    cirrus.get(accessToken, `/${constants.Event}`, { params }),
  ]);

  const total = countRes.data?.[0]?.count || 0;
  const events = dataRes.data || [];

  // Extract token addresses and fetch their symbols
  const tokenAddresses = extractTokenAddresses(events);
  const tokenMap = await getTokenMetadata(accessToken, tokenAddresses);

  // Transform events with token symbol lookup
  const activities = events.map((event: any) => transformEvent(event, tokenMap));

  return { activities, total, limit, offset };
};
