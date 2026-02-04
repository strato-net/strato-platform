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

export interface FilterConfig {
  type: "single" | "or";
  attribute?: string;
  attributes?: string[];
}

export interface ActivityTypePair {
  contract_name: string;
  event_name: string;
  filterConfig?: FilterConfig;
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
  userAddress: string | undefined,
  contractName: string,
  eventName: string,
  storageSelect: string,
  fetchLimit: number,
  accessToken: string,
  timeRange?: string,
  filterConfig?: FilterConfig
) => Promise<FilterQueryResult>;

/**
 * Helper function to get time range filter for PostgREST
 */
const getTimeRangeFilter = (timeRange?: string): Record<string, string> => {
  if (!timeRange || timeRange === 'all') {
    return {};
  }

  const now = new Date();
  let startDate: Date;

  switch (timeRange) {
    case 'today':
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 1);
      break;
    case 'week':
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 7);
      break;
    case 'month':
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 1);
      break;
    default:
      return {};
  }

  // Format as ISO string for PostgREST
  const isoString = startDate.toISOString();
  return {
    "block_timestamp": `gte.${isoString}`,
  };
};

/**
 * Generic filter for single attribute filtering
 */
const singleAttributeFilter: ActivityFilter = async (
  userAddress,
  contractName,
  eventName,
  storageSelect,
  fetchLimit,
  accessToken,
  timeRange,
  filterConfig?: FilterConfig
) => {
  const timeFilter = getTimeRangeFilter(timeRange);
  const attribute = filterConfig?.type === "single" ? filterConfig.attribute : undefined;

  const params: Record<string, string> = {
    order: "block_timestamp.desc",
    select: `*,${storageSelect}`,
    "storage.contract.contract_name": `eq.${contractName}`,
    event_name: `eq.${eventName}`,
    limit: fetchLimit.toString(),
    offset: "0",
    ...timeFilter,
  };

  if (userAddress && attribute) {
    params[`attributes->>${attribute}`] = `eq.${userAddress}`;
  }

  const countParams: Record<string, string> = {
    "storage.contract.contract_name": `eq.${contractName}`,
    event_name: `eq.${eventName}`,
    select: `${storageSelect},count()`,
    ...timeFilter,
  };

  if (userAddress && attribute) {
    countParams[`attributes->>${attribute}`] = `eq.${userAddress}`;
  }

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

/**
 * Generic filter for OR attribute filtering (e.g., from OR to)
 */
const orAttributeFilter: ActivityFilter = async (
  userAddress,
  contractName,
  eventName,
  storageSelect,
  fetchLimit,
  accessToken,
  timeRange,
  filterConfig?: FilterConfig
) => {
  if (!userAddress) {
    // If no userAddress, fetch all events without user filtering
    const timeFilter = getTimeRangeFilter(timeRange);
    const params: Record<string, string> = {
      order: "block_timestamp.desc",
      select: `*,${storageSelect}`,
      "storage.contract.contract_name": `eq.${contractName}`,
      event_name: `eq.${eventName}`,
      limit: fetchLimit.toString(),
      offset: "0",
      ...timeFilter,
    };

    const countParams: Record<string, string> = {
      "storage.contract.contract_name": `eq.${contractName}`,
      event_name: `eq.${eventName}`,
      select: `${storageSelect},count()`,
      ...timeFilter,
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

  const timeFilter = getTimeRangeFilter(timeRange);
  const attributes = filterConfig?.type === "or" ? (filterConfig.attributes || []) : [];

  if (attributes.length === 0) {
    throw new Error("OR filter requires at least one attribute");
  }

  const baseParams = {
    order: "block_timestamp.desc",
    select: `*,${storageSelect}`,
    "storage.contract.contract_name": `eq.${contractName}`,
    event_name: `eq.${eventName}`,
    limit: fetchLimit.toString(),
    offset: "0",
    ...timeFilter,
  };

  // Create params for each attribute
  const attributeParams = attributes.map(attr => ({
    ...baseParams,
    [`attributes->>${attr}`]: `eq.${userAddress}`,
  }));

  const attributeCountParams = attributes.map(attr => ({
    "storage.contract.contract_name": `eq.${contractName}`,
    event_name: `eq.${eventName}`,
    [`attributes->>${attr}`]: `eq.${userAddress}`,
    select: `${storageSelect},count()`,
    ...timeFilter,
  }));

  // Execute all queries in parallel
  const allPromises: Promise<any>[] = [];
  attributeCountParams.forEach(params => {
    allPromises.push(cirrus.get(accessToken, `/${constants.Event}`, { params }));
  });
  attributeParams.forEach(params => {
    allPromises.push(cirrus.get(accessToken, `/${constants.Event}`, { params }));
  });

  if (allPromises.length === 0) {
    return { events: [], total: 0 };
  }

  const responses = await Promise.all(allPromises);
  const countResponses = responses.slice(0, attributes.length);
  const eventResponses = responses.slice(attributes.length);

  // Combine totals (conservative estimate)
  const totals = countResponses.map(r => r.data?.[0]?.count || 0);
  const total = Math.max(...totals);

  // Combine and deduplicate events
  const allEvents = eventResponses.flatMap((response: any) => {
    return (response.data || []).map((event: any) => {
      const { storage, ...eventWithoutStorage } = event;
      return {
        ...eventWithoutStorage,
        contract_name: event.storage?.contract?.[0]?.contract_name || "",
      };
    });
  });

  // Deduplicate by id
  const eventMap = new Map<number, any>();
  allEvents.forEach(event => {
    eventMap.set(event.id, event);
  });

  return { events: Array.from(eventMap.values()), total };
};

/**
 * Get filter function based on filter config
 */
const getFilter = (filterConfig?: FilterConfig): ActivityFilter => {
  if (!filterConfig) {
    throw new Error("Filter config is required");
  }

  if (filterConfig.type === "or") {
    return orAttributeFilter;
  } else {
    return singleAttributeFilter;
  }
};



export const getActivitiesByTypes = async (
  accessToken: string,
  activityTypePairs: ActivityTypePair[],
  userAddress: string | undefined,
  limit: number,
  offset: number,
  timeRange?: string
): Promise<EventResponse> => {
  const storageSelect = "storage!inner(contract!inner(contract_name))";

  // Query each pair separately to get accurate counts
  // We fetch enough events to cover offset + limit for accurate pagination
  // Note: For very high offsets, this will fetch many events and be slower
  // Consider implementing cursor-based pagination for better performance at scale
  const fetchLimit = limit + offset;

  const timeFilter = getTimeRangeFilter(timeRange);

  const pairQueries = activityTypePairs.map(async (pair) => {
    // If no userAddress, fetch all events without user filtering
    if (!userAddress) {
      const params: Record<string, string> = {
        order: "block_timestamp.desc",
        select: `*,${storageSelect}`,
        "storage.contract.contract_name": `eq.${pair.contract_name}`,
        event_name: `eq.${pair.event_name}`,
        limit: fetchLimit.toString(),
        offset: "0",
        ...timeFilter,
      };

      const countParams: Record<string, string> = {
        "storage.contract.contract_name": `eq.${pair.contract_name}`,
        event_name: `eq.${pair.event_name}`,
        select: `${storageSelect},count()`,
        ...timeFilter,
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

    // Use generic filter based on filterConfig
    if (!pair.filterConfig) {
      throw new Error(`No filter config provided for activity type: ${pair.contract_name}:${pair.event_name}`);
    }

    const filter = getFilter(pair.filterConfig);
    return await filter(userAddress, pair.contract_name, pair.event_name, storageSelect, fetchLimit, accessToken, timeRange, pair.filterConfig);
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
