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

    // Get total count
    const countParams = {
      application: params.application,
      creator: params.creator
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