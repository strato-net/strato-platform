import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import type { EventData, EventResponse, ContractInfoResponse } from "@mercata/shared-types";

export const getEvents = async (
  accessToken: string,
  query: Record<string, string> = {}
): Promise<EventResponse> => {
  const params = {
    ...query,
    order: query.order || "block_timestamp.desc"
  };

  const countParams = { ...params, limit: undefined, offset: undefined, order: undefined };
  
  const [countResponse, eventsResponse] = await Promise.all([
    cirrus.get(accessToken, `/${constants.Event}?select=count()`, { 
      params: countParams 
    }),
    cirrus.get(accessToken, `/${constants.Event}`, { params })
  ]);
  
  const total = countResponse.data?.[0]?.count || 0;
  const data = eventsResponse.data;
  
  return {
    events: data || [],
    total: total
  };
};

export const getContractInfo = async (
  accessToken: string
): Promise<ContractInfoResponse> => {
  const contracts = new Map<string, Set<string>>();

  const { data } = await cirrus.get(accessToken, `/${constants.Event}`, {
    params: {
      select: "contract_name,event_name,event_name.count()",
      order: "contract_name.asc,event_name.asc"
    }
  });

  (data as EventData[])?.forEach(event => {
    if (!event?.event_name || !event?.contract_name) return;
    
    if (!contracts.has(event.contract_name)) {
      contracts.set(event.contract_name, new Set());
    }
    contracts.get(event.contract_name)!.add(event.event_name);
  });

  return {
    contracts: Array.from(contracts.entries())
      .map(([name, events]) => ({
        name,
        events: [...events].sort()
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  };
};
