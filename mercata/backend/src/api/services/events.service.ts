import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getInternalAddresses } from "../../config/config";
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
  /** Event attribute names to check against the protocol address list for exclusion */
  excludeProtocolAddresses?: string[];
}

export interface ActivityTypePair {
  contract_name: string;
  event_name: string;
  filterConfig?: FilterConfig;
}

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
 * Build attribute filters for a set of activity type pairs for a given user address.
 * Returns deduplicated PostgREST filter conditions.
 */
const buildAttributeFilters = (pairs: ActivityTypePair[], userAddress: string): string[] => {
  const filters: string[] = [];
  for (const pair of pairs) {
    if (!pair.filterConfig) {
      throw new Error(`No filter config provided for activity type: ${pair.contract_name}:${pair.event_name}`);
    }
    if (pair.filterConfig.type === "single") {
      if (!pair.filterConfig.attribute) {
        throw new Error(`Single filter requires attribute for ${pair.contract_name}:${pair.event_name}`);
      }
      filters.push(`attributes->>${pair.filterConfig.attribute}.eq.${userAddress}`);
    } else {
      const attributes = pair.filterConfig.attributes || [];
      if (attributes.length === 0) {
        throw new Error(`OR filter requires attributes for ${pair.contract_name}:${pair.event_name}`);
      }
      for (const attr of attributes) {
        filters.push(`attributes->>${attr}.eq.${userAddress}`);
      }
    }
  }
  return [...new Set(filters)];
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
  if (activityTypePairs.length === 0) {
    return { events: [], total: 0 };
  }

  const timeFilter = getTimeRangeFilter(timeRange);

  // Group pairs by contract_name to avoid cross-product from independent in() lists.
  // Each group gets its own query with exact contract_name + event_name filtering.
  const groups = new Map<string, ActivityTypePair[]>();
  for (const pair of activityTypePairs) {
    if (!pair.contract_name || !pair.event_name) continue;
    const existing = groups.get(pair.contract_name);
    if (existing) {
      existing.push(pair);
    } else {
      groups.set(pair.contract_name, [pair]);
    }
  }

  if (groups.size === 0) {
    return { events: [], total: 0 };
  }

  const groupEntries = Array.from(groups.entries());

  // Build parallel queries: one count + one data query per contract group.
  // For data, fetch (limit + offset) from each group so merge-sort can produce
  // the correct global page. Any event in the global top N must be in the top N
  // of its own group, so this is always correct.
  const fetchLimit = limit + offset;

  // Exclude internal transfers involving protocol contracts.
  // Activity types opt in via excludeProtocolAddresses in their filterConfig.
  const internalAddresses = getInternalAddresses();
  const internalAddrList = internalAddresses.join(",");

  const applyFilters = (
    pairs: ActivityTypePair[],
    params: Record<string, string>
  ) => {
    if (internalAddrList) {
      for (const pair of pairs) {
        const attrs = pair.filterConfig?.excludeProtocolAddresses;
        if (attrs) {
          for (const attr of attrs) {
            params[`attributes->>${attr}`] = `not.in.(${internalAddrList})`;
          }
        }
      }
    }
    // Filter by user address for My Activity
    if (userAddress) {
      const attrFilters = buildAttributeFilters(pairs, userAddress);
      if (attrFilters.length > 0) {
        params.or = `(${attrFilters.join(",")})`;
      }
    }
  };

  const countPromises = groupEntries.map(([contractName, pairs]) => {
    const eventNames = pairs.map(p => p.event_name);
    const countParams: Record<string, string> = {
      select: `${storageSelect},count()`,
      "storage.contract.contract_name": `eq.${contractName}`,
      event_name: eventNames.length === 1
        ? `eq.${eventNames[0]}`
        : `in.(${eventNames.join(",")})`,
      ...timeFilter,
    };
    applyFilters(pairs, countParams);
    return cirrus.get(accessToken, `/${constants.Event}`, { params: countParams });
  });

  const dataPromises = groupEntries.map(([contractName, pairs]) => {
    const eventNames = pairs.map(p => p.event_name);
    const params: Record<string, string> = {
      order: "block_timestamp.desc,id.desc",
      select: `*,${storageSelect}`,
      limit: fetchLimit.toString(),
      offset: "0",
      "storage.contract.contract_name": `eq.${contractName}`,
      event_name: eventNames.length === 1
        ? `eq.${eventNames[0]}`
        : `in.(${eventNames.join(",")})`,
      ...timeFilter,
    };
    applyFilters(pairs, params);
    return cirrus.get(accessToken, `/${constants.Event}`, { params });
  });

  // Run all queries in parallel
  const allResults = await Promise.all([...countPromises, ...dataPromises]);
  const countResults = allResults.slice(0, groupEntries.length);
  const dataResults = allResults.slice(groupEntries.length);

  // Sum counts across groups for exact total
  const total = countResults.reduce((sum, res) => {
    return sum + (res.data || []).reduce((s: number, row: any) => {
      return s + (Number(row?.count) || 0);
    }, 0);
  }, 0);

  // Merge all data results and extract contract_name from storage relationship
  const allEvents = dataResults.flatMap(res =>
    (res.data || []).map((event: any) => {
      const { storage, ...eventWithoutStorage } = event;
      return {
        ...eventWithoutStorage,
        contract_name: event.storage?.contract?.[0]?.contract_name || "",
      };
    })
  );

  // Sort merged results by (block_timestamp desc, id desc) to match DB ordering
  allEvents.sort((a, b) => {
    const tsCompare = (b.block_timestamp || "").localeCompare(a.block_timestamp || "");
    if (tsCompare !== 0) return tsCompare;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });

  // Apply global pagination: slice [offset, offset + limit]
  const events = allEvents.slice(offset, offset + limit);

  return { events, total };
};
