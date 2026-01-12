import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import type {
  EventData,
  EventResponse,
  ContractInfoResponse,
} from "@mercata/shared-types";
import {
  EVENT_TYPE_MAP,
  ActivityItem,
  extractTokenAddresses,
  fetchTokenMetadata,
  transformEvent,
  fetchActivityEventsFromCirrus,
  getActivityEvents
} from "./activity.helpers";

export interface ActivitiesResponse {
  activities: ActivityItem[];
  total: number;
  limit: number;
  offset: number;
}

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
  const { limit, offset, order, ...countQuery } = query;
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

export const getActivities = async (
  accessToken: string,
  query: {
    limit?: number;
    offset?: number;
    userAddress?: string;
    type?: string;
  } = {}
): Promise<ActivitiesResponse> => {
  const { limit = 10, offset = 0, userAddress, type } = query;
  const storageSelect = "storage!inner(contract!inner(contract_name))";

  // Fetch activity events dynamically from Cirrus (with caching)
  // This validates our event list against what actually exists on-chain
  const activityEvents = await fetchActivityEventsFromCirrus(accessToken);

  // Build event name filter based on type
  let eventNames = activityEvents;
  if (type && type !== 'all') {
    // Filter to events of the specified type that exist on-chain
    eventNames = Object.entries(EVENT_TYPE_MAP)
      .filter(([eventName, eventType]) => eventType === type && activityEvents.includes(eventName))
      .map(([name]) => name);
  }

  // If no matching events found, return empty response
  if (eventNames.length === 0) {
    return { activities: [], total: 0, limit, offset };
  }

  const params: Record<string, string> = {
    select: `*,${storageSelect}`,
    order: 'block_timestamp.desc',
    event_name: `in.(${eventNames.join(',')})`,
    limit: limit.toString(),
    offset: offset.toString(),
  };

  if (userAddress) {
    params.transaction_sender = `eq.${userAddress}`;
  }

  // Build count params (exclude limit, offset, order)
  const { limit: _l, offset: _o, order: _ord, ...countBase } = params;
  const countParams = { ...countBase, select: `${storageSelect},count()` };

  const [countRes, eventsRes] = await Promise.all([
    cirrus.get(accessToken, `/${constants.Event}`, { params: countParams }),
    cirrus.get(accessToken, `/${constants.Event}`, { params }),
  ]);

  const total = countRes.data?.[0]?.count || 0;
  const events = eventsRes.data || [];

  // Fetch token metadata for all token addresses in events
  const tokenAddresses = extractTokenAddresses(events);
  const tokenMap = await fetchTokenMetadata(accessToken, tokenAddresses);

  // Transform events to activities
  const activities = events.map((event: any) => transformEvent(event, tokenMap));

  return { activities, total, limit, offset };
};
