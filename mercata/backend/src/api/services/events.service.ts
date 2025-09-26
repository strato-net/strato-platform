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
    
    const countResponse = await cirrus.get(accessToken, `/${constants.Event}?select=count()`, { 
      params: countParams 
    });
    const total = countResponse.data?.[0]?.count || 0;

    // Get events with pagination
    const { data } = await cirrus.get(accessToken, `/${constants.Event}`, { params });
    
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
  const DEFAULT_LIMIT = 1000;
  let offset = 0;
  const contracts = new Map<string, Set<string>>();

  try {
    while (true) {
      const params: Record<string, string> = {
        application: "eq.Mercata",
        creator: "eq.BlockApps",
        select: "contract_name,event_name",
        order: "contract_name.asc,event_name.asc",
        limit: DEFAULT_LIMIT.toString(),
        offset: offset.toString()
      };

      const { data } = await cirrus.get(accessToken, `/${constants.Event}`, { params });

      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      for (const event of data) {
        const contractName = typeof event?.contract_name === "string" ? event.contract_name.trim() : "";
        const eventName = typeof event?.event_name === "string" ? event.event_name.trim() : "";

        if (!contractName || !eventName) continue;

        if (!contracts.has(contractName)) {
          contracts.set(contractName, new Set());
        }

        contracts.get(contractName)!.add(eventName);
      }

      if (data.length < DEFAULT_LIMIT) {
        break;
      }

      offset += DEFAULT_LIMIT;
    }

    const contractList = Array.from(contracts.entries())
      .map(([name, events]) => ({
        name,
        events: Array.from(events).sort((a, b) => a.localeCompare(b))
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { contracts: contractList };
  } catch (error) {
    console.error("Error fetching contract info:", error);
    throw new Error("Failed to fetch contract metadata from the blockchain");
  }
};
