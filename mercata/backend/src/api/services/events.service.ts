import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import type { EventData, EventResponse, ContractInfoResponse, Event } from "@mercata/shared-types";

export const getEvents = async (
  accessToken: string,
  query: Record<string, string> = {}
): Promise<EventResponse> => {
  const params = {
    ...query,
    creator: query.creator || "eq.BlockApps",
    select: "*,storage(contract(*))",
    order: query.order || "block_timestamp.desc"
  };

  const countParams = {
    ...params,
    limit: undefined,
    offset: undefined,
    order: undefined
  };
  
  const [countResponse, eventsResponse] = await Promise.all([
    cirrus.get(accessToken, `/${constants.Event}`, { 
      params: { ...countParams, select: "*,storage(contract(*)),count()" }
    }),
    cirrus.get(accessToken, `/${constants.Event}`, { params })
  ]);
  
  const total = countResponse.data?.[0]?.count || 0;
  const data = eventsResponse.data;
  
  return {
    events: data?.map((event: Event & { storage?: any }) => {
      const contractName = event.storage?.contract?.[0]?.contract_name;
      return { ...event, contract_name: contractName, storage: undefined };
    }) || [],
    total: total
  };
};

export const getContractInfo = async (
  accessToken: string
): Promise<ContractInfoResponse> => {
  const contracts = new Map<string, Set<string>>();

  const { data } = await cirrus.get(accessToken, `/${constants.Event}`, {
    params: {
      creator: "eq.BlockApps",
      select: "event_name,event_name.count(),storage(contract(contract_name,contract_name.count()))",
      "storage.contract.contract_name": "neq.Proxy",
      order: "event_name.asc"
    }
  });

  (data as EventData[])?.forEach(event => {
    const eventName = event?.event_name?.trim();
    if (!eventName) return;

    event?.storage?.contract?.forEach(contract => {
      const contractName = contract?.contract_name?.trim();
      if (!contractName) return;

      if (!contracts.has(contractName)) {
        contracts.set(contractName, new Set());
      }
      contracts.get(contractName)!.add(eventName);
    });
  });

  return {
    contracts: Array.from(contracts.entries())
      .map(([name, events]) => ({
        name,
        events: Array.from(events).sort()
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  };
};
