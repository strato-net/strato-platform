import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import type {
  EventData,
  EventResponse,
  ContractInfoResponse,
} from "@mercata/shared-types";

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

export interface ActivityTypePair {
  contract_name: string;
  event_name: string;
}

/**
 * Result of a filter query - can be a single query result or multiple queries that need combining
 */
interface FilterQueryResult {
  events: any[];
  total: number;
}

/**
 * Filter function for "my activity" queries
 * Returns filter parameters and optionally a custom query executor for complex cases
 */
type ActivityFilter = (
  userAddress: string,
  contractName: string,
  eventName: string,
  storageSelect: string,
  fetchLimit: number,
  accessToken: string
) => Promise<FilterQueryResult>;

/**
 * Mapping from (contract_name, event_name) to filter functions
 * Defines how to filter events for "my activity" for each activity type
 */
const activityFilters: Record<string, ActivityFilter> = {
  // Transfer events: filter by from OR to
  "Token:Transfer": async (userAddress, contractName, eventName, storageSelect, fetchLimit, accessToken) => {
    const baseParams = {
      order: "block_timestamp.desc",
      select: `*,${storageSelect}`,
      "storage.contract.contract_name": `eq.${contractName}`,
      event_name: `eq.${eventName}`,
      limit: fetchLimit.toString(),
      offset: "0",
    };

    const fromParams = {
      ...baseParams,
      "attributes->>from": `eq.${userAddress}`,
    };

    const toParams = {
      ...baseParams,
      "attributes->>to": `eq.${userAddress}`,
    };

    const fromCountParams: Record<string, string> = {
      "storage.contract.contract_name": `eq.${contractName}`,
      event_name: `eq.${eventName}`,
      "attributes->>from": `eq.${userAddress}`,
      select: `${storageSelect},count()`,
    };

    const toCountParams: Record<string, string> = {
      "storage.contract.contract_name": `eq.${contractName}`,
      event_name: `eq.${eventName}`,
      "attributes->>to": `eq.${userAddress}`,
      select: `${storageSelect},count()`,
    };

    const [fromCountResponse, fromEventsResponse, toCountResponse, toEventsResponse] = await Promise.all([
      cirrus.get(accessToken, `/${constants.Event}`, { params: fromCountParams }),
      cirrus.get(accessToken, `/${constants.Event}`, { params: fromParams }),
      cirrus.get(accessToken, `/${constants.Event}`, { params: toCountParams }),
      cirrus.get(accessToken, `/${constants.Event}`, { params: toParams }),
    ]);

    const fromTotal = fromCountResponse.data?.[0]?.count || 0;
    const toTotal = toCountResponse.data?.[0]?.count || 0;
    
    const fromEvents = (fromEventsResponse.data || []).map((event: any) => {
      const { storage, ...eventWithoutStorage } = event;
      return {
        ...eventWithoutStorage,
        contract_name: event.storage?.contract?.[0]?.contract_name || "",
      };
    });
    
    const toEvents = (toEventsResponse.data || []).map((event: any) => {
      const { storage, ...eventWithoutStorage } = event;
      return {
        ...eventWithoutStorage,
        contract_name: event.storage?.contract?.[0]?.contract_name || "",
      };
    });

    // Deduplicate by id
    const eventMap = new Map<number, any>();
    [...fromEvents, ...toEvents].forEach(event => {
      eventMap.set(event.id, event);
    });

    const total = Math.max(fromTotal, toTotal); // Conservative estimate

    return { events: Array.from(eventMap.values()), total };
  },

  // Voucher Transfer events: same as Token Transfer
  "Voucher:Transfer": async (userAddress, contractName, eventName, storageSelect, fetchLimit, accessToken) => {
    // Reuse the same logic as Token:Transfer
    return activityFilters["Token:Transfer"]!(userAddress, contractName, eventName, storageSelect, fetchLimit, accessToken);
  },

  // DepositCompleted events: filter by stratoRecipient
  "MercataBridge:DepositCompleted": async (userAddress, contractName, eventName, storageSelect, fetchLimit, accessToken) => {
    const params = {
      order: "block_timestamp.desc",
      select: `*,${storageSelect}`,
      "storage.contract.contract_name": `eq.${contractName}`,
      event_name: `eq.${eventName}`,
      "attributes->>stratoRecipient": `eq.${userAddress}`,
      limit: fetchLimit.toString(),
      offset: "0",
    };

    const countParams: Record<string, string> = {
      "storage.contract.contract_name": `eq.${contractName}`,
      event_name: `eq.${eventName}`,
      "attributes->>stratoRecipient": `eq.${userAddress}`,
      select: `${storageSelect},count()`,
    };

    const [countResponse, eventsResponse] = await Promise.all([
      cirrus.get(accessToken, `/${constants.Event}`, { params: countParams }),
      cirrus.get(accessToken, `/${constants.Event}`, { params }),
    ]);

    const total = countResponse.data?.[0]?.count || 0;
    const data = eventsResponse.data || [];

    const events = (data as any[]).map((event: any) => {
      const { storage, ...eventWithoutStorage } = event;
      return {
        ...eventWithoutStorage,
        contract_name: event.storage?.contract?.[0]?.contract_name || "",
      };
    });

    return { events, total };
  },

  // USDSTMinted events: filter by owner
  "CDPEngine:USDSTMinted": async (userAddress, contractName, eventName, storageSelect, fetchLimit, accessToken) => {
    const params = {
      order: "block_timestamp.desc",
      select: `*,${storageSelect}`,
      "storage.contract.contract_name": `eq.${contractName}`,
      event_name: `eq.${eventName}`,
      "attributes->>owner": `eq.${userAddress}`,
      limit: fetchLimit.toString(),
      offset: "0",
    };

    const countParams: Record<string, string> = {
      "storage.contract.contract_name": `eq.${contractName}`,
      event_name: `eq.${eventName}`,
      "attributes->>owner": `eq.${userAddress}`,
      select: `${storageSelect},count()`,
    };

    const [countResponse, eventsResponse] = await Promise.all([
      cirrus.get(accessToken, `/${constants.Event}`, { params: countParams }),
      cirrus.get(accessToken, `/${constants.Event}`, { params }),
    ]);

    const total = countResponse.data?.[0]?.count || 0;
    const data = eventsResponse.data || [];

    const events = (data as any[]).map((event: any) => {
      const { storage, ...eventWithoutStorage } = event;
      return {
        ...eventWithoutStorage,
        contract_name: event.storage?.contract?.[0]?.contract_name || "",
      };
    });

    return { events, total };
  },
};

/**
 * Default filter: filter by transaction_sender
 */
const defaultFilter: ActivityFilter = async (userAddress, contractName, eventName, storageSelect, fetchLimit, accessToken) => {
  const params: Record<string, string> = {
    order: "block_timestamp.desc",
    select: `*,${storageSelect}`,
    "storage.contract.contract_name": `eq.${contractName}`,
    event_name: `eq.${eventName}`,
    transaction_sender: `eq.${userAddress}`,
    limit: fetchLimit.toString(),
    offset: "0",
  };

  const countParams: Record<string, string> = {
    "storage.contract.contract_name": `eq.${contractName}`,
    event_name: `eq.${eventName}`,
    transaction_sender: `eq.${userAddress}`,
    select: `${storageSelect},count()`,
  };

  const [countResponse, eventsResponse] = await Promise.all([
    cirrus.get(accessToken, `/${constants.Event}`, { params: countParams }),
    cirrus.get(accessToken, `/${constants.Event}`, { params }),
  ]);

  const total = countResponse.data?.[0]?.count || 0;
  const data = eventsResponse.data || [];

  const events = (data as any[]).map((event: any) => {
    const { storage, ...eventWithoutStorage } = event;
    return {
      ...eventWithoutStorage,
      contract_name: event.storage?.contract?.[0]?.contract_name || "",
    };
  });

  return { events, total };
};

export const getActivitiesByTypes = async (
  accessToken: string,
  activityTypePairs: ActivityTypePair[],
  userAddress: string | undefined,
  limit: number,
  offset: number
): Promise<EventResponse> => {
  const storageSelect = "storage!inner(contract!inner(contract_name))";
  
  // Query each pair separately to get accurate counts
  // We fetch enough events to cover offset + limit for accurate pagination
  // Note: For very high offsets, this will fetch many events and be slower
  // Consider implementing cursor-based pagination for better performance at scale
  const fetchLimit = limit + offset;
  
  const pairQueries = activityTypePairs.map(async (pair) => {
    // If no userAddress, fetch all events without filtering
    if (!userAddress) {
      const params: Record<string, string> = {
        order: "block_timestamp.desc",
        select: `*,${storageSelect}`,
        "storage.contract.contract_name": `eq.${pair.contract_name}`,
        event_name: `eq.${pair.event_name}`,
        limit: fetchLimit.toString(),
        offset: "0",
      };

      const countParams: Record<string, string> = {
        "storage.contract.contract_name": `eq.${pair.contract_name}`,
        event_name: `eq.${pair.event_name}`,
        select: `${storageSelect},count()`,
      };

      const [countResponse, eventsResponse] = await Promise.all([
        cirrus.get(accessToken, `/${constants.Event}`, { params: countParams }),
        cirrus.get(accessToken, `/${constants.Event}`, { params }),
      ]);

      const total = countResponse.data?.[0]?.count || 0;
      const data = eventsResponse.data || [];

      const events = (data as any[]).map((event: any) => {
        const { storage, ...eventWithoutStorage } = event;
        return {
          ...eventWithoutStorage,
          contract_name: event.storage?.contract?.[0]?.contract_name || "",
        };
      });

      return { events, total };
    }

    // Use the filter function for this activity type, or default filter
    const filterKey = `${pair.contract_name}:${pair.event_name}`;
    const filter = activityFilters[filterKey] || defaultFilter;
    
    return await filter(userAddress, pair.contract_name, pair.event_name, storageSelect, fetchLimit, accessToken);
  });

  const pairResults = await Promise.all(pairQueries);
  
  // Combine all events and sort by block_timestamp descending
  const allEvents = pairResults.flatMap(r => r.events);
  allEvents.sort((a, b) => {
    const timestampA = new Date(a.block_timestamp).getTime();
    const timestampB = new Date(b.block_timestamp).getTime();
    return timestampB - timestampA;
  });

  // Sum total counts
  const total = pairResults.reduce((sum, r) => sum + r.total, 0);

  // Apply pagination
  const paginatedEvents = allEvents.slice(offset, offset + limit);

  return {
    events: paginatedEvents,
    total: total,
  };
};
