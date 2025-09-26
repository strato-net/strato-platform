import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";

export const getEvents = async (
  accessToken: string,
  query: Record<string, string> = {}
): Promise<{ events: any[], total: number }> => {
  try {
    // Add default filters unless explicitly provided
    const params = {
      ...query,
      application: query.application || "eq.Mercata",
      creator: query.creator || "eq.BlockApps",
      order: query.order || "block_timestamp.desc"
    };

    // Get total count - include all filter parameters
    const countParams = {
      ...params,
      // Remove pagination parameters from count query
      limit: undefined,
      offset: undefined,
      order: undefined
    };
    
    // Make both API calls in parallel
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
  } catch (error) {
    console.error("Error fetching events:", error);
    throw new Error("Failed to fetch events from the blockchain");
  }
};

export const getContractInfo = async (
  accessToken: string
): Promise<{ contracts: Array<{ name: string; events: string[] }> }> => {
  const contracts = new Map<string, Set<string>>();

  const params: Record<string, string> = {
    application: "eq.Mercata",
    creator: "eq.BlockApps",
    select: "contract_name,event_name,event_name.count()",
    order: "contract_name.asc,event_name.asc"
  };

  const { data } = await cirrus.get(accessToken, `/${constants.Event}`, { params });

  if (Array.isArray(data)) {
    for (const event of data) {
      const contractName = typeof event?.contract_name === "string" ? event.contract_name.trim() : "";
      const eventName = typeof event?.event_name === "string" ? event.event_name.trim() : "";

      if (!contractName || !eventName) continue;

      if (!contracts.has(contractName)) {
        contracts.set(contractName, new Set());
      }

      contracts.get(contractName)!.add(eventName);
    }
  }

  const contractList = Array.from(contracts.entries())
    .map(([name, events]) => ({
      name,
      events: Array.from(events).sort((a, b) => a.localeCompare(b))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { contracts: contractList };
};
