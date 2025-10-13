import { cirrus } from "../../../utils/mercataApiHelper";
import { constants } from "../../../config/constants";

const { RewardsChef } = constants;

/**
 * Low-level function to fetch pools from RewardsChef contract using Cirrus
 * with optional additional query parameters
 *
 * @param accessToken - User access token for authentication
 * @param rewardsChefAddress - Address of the RewardsChef contract
 * @param additionalParams - Optional additional Cirrus query parameters for filtering
 * @returns Promise resolving to array of pool information
 */
export const getPoolsCirrus = async (
  accessToken: string,
  rewardsChefAddress: string,
  additionalParams?: Record<string, string>
): Promise<Array<{
  poolIdx: number;
  lpToken: string;
  allocPoint: string;
  accPerToken: string;
  lastRewardTimestamp: string;
}>> => {
  try {
    const response = await cirrus.get(accessToken, `/${RewardsChef}-pools`, {
      params: {
        address: `eq.${rewardsChefAddress}`,
        ...additionalParams
      }
    });

    // Filter out entries with empty values and map to desired format
    const pools = response.data
      ?.filter((entry: any) => entry.value && entry.value !== "")
      .map((entry: any) => ({
        poolIdx: entry.key,
        lpToken: entry.value.lpToken,
        allocPoint: entry.value.allocPoint,
        accPerToken: entry.value.accPerToken,
        lastRewardTimestamp: entry.value.lastRewardTimestamp
      })) || [];

    return pools;
  } catch (error) {
    console.error("Failed to fetch pools from RewardsChef:", error);
    return [];
  }
};
