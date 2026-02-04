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

  const contractNames = Array.from(
    new Set(activityTypePairs.map((pair) => pair.contract_name).filter(Boolean))
  );
  const eventNames = Array.from(
    new Set(activityTypePairs.map((pair) => pair.event_name).filter(Boolean))
  );

  if (contractNames.length === 0 || eventNames.length === 0) {
    return { events: [], total: 0 };
  }

  const attributeFilters: string[] = [];
  if (userAddress) {
    activityTypePairs.forEach((pair) => {
      if (!pair.filterConfig) {
        throw new Error(`No filter config provided for activity type: ${pair.contract_name}:${pair.event_name}`);
      }

      if (pair.filterConfig.type === "single") {
        if (!pair.filterConfig.attribute) {
          throw new Error(`Single filter requires attribute for ${pair.contract_name}:${pair.event_name}`);
        }
        attributeFilters.push(`attributes->>${pair.filterConfig.attribute}.eq.${userAddress}`);
        return;
      }

      const attributes = pair.filterConfig.attributes || [];
      if (attributes.length === 0) {
        throw new Error(`OR filter requires attributes for ${pair.contract_name}:${pair.event_name}`);
      }
      attributes.forEach((attr) => {
        attributeFilters.push(`attributes->>${attr}.eq.${userAddress}`);
      });
    });
  }

  const uniqueAttributeFilters = Array.from(new Set(attributeFilters));

  const params: Record<string, string> = {
    order: "block_timestamp.desc,id.desc",
    select: `*,${storageSelect}`,
    limit: limit.toString(),
    offset: offset.toString(),
    "storage.contract.contract_name": `in.(${contractNames.join(",")})`,
    event_name: `in.(${eventNames.join(",")})`,
    ...timeFilter,
  };

  const countParams: Record<string, string> = {
    select: `${storageSelect},count()`,
    "storage.contract.contract_name": `in.(${contractNames.join(",")})`,
    event_name: `in.(${eventNames.join(",")})`,
    ...timeFilter,
  };

  if (uniqueAttributeFilters.length > 0) {
    params.or = `(${uniqueAttributeFilters.join(",")})`;
    countParams.or = `(${uniqueAttributeFilters.join(",")})`;
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
