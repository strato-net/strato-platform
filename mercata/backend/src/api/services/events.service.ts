import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";

export const getEvents = async (
  accessToken: string,
  query: Record<string, string> = {}
): Promise<any[]> => {
  try {
    // Add default filters unless explicitly provided
    const params = {
      ...query,
      application: query.application || "eq.Mercata",
      creator: query.creator || "eq.BlockApps"
    };

    const { data } = await cirrus.get(accessToken, `/${constants.Event}`, { params });
    return data || [];
  } catch (error) {
    console.error("Error fetching events:", error);
    throw new Error("Failed to fetch events from the blockchain");
  }
}; 