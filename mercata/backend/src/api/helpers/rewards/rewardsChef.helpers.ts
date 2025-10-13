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
 * @param includePeriods - Whether to include bonusPeriods in the result (default: false)
 * @returns Promise resolving to array of pool information
 */
export const getPoolsCirrus = async (
  accessToken: string,
  rewardsChefAddress: string,
  additionalParams?: Record<string, string>,
  includePeriods: boolean = false
): Promise<Array<{
  poolIdx: number;
  lpToken: string;
  allocPoint: string;
  accPerToken: string;
  lastRewardTimestamp: string;
  bonusPeriods?: Array<{ startTimestamp: string; bonusMultiplier: string }>;
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
      .map((entry: any) => {
        const pool: any = {
          poolIdx: entry.key,
          lpToken: entry.value.lpToken,
          allocPoint: entry.value.allocPoint,
          accPerToken: entry.value.accPerToken,
          lastRewardTimestamp: entry.value.lastRewardTimestamp
        };

        // Include bonusPeriods if requested, sorted by startTimestamp
        if (includePeriods && entry.value.bonusPeriods) {
          pool.bonusPeriods = [...entry.value.bonusPeriods].sort(
            (a: any, b: any) => BigInt(a.startTimestamp) < BigInt(b.startTimestamp) ? -1 : 1
          );
        }

        return pool;
      }) || [];

    return pools;
  } catch (error) {
    console.error("Failed to fetch pools from RewardsChef:", error);
    return [];
  }
};

/**
 * Get user's info (staked balance and reward debt) from RewardsChef
 *
 * @param accessToken - User access token for authentication
 * @param rewardsChefAddress - Address of the RewardsChef contract
 * @param poolId - Pool ID to query
 * @param userAddress - User address to fetch info for
 * @returns Promise resolving to user info object
 */
export const getUserInfo = async (
  accessToken: string,
  rewardsChefAddress: string,
  poolId: number,
  userAddress: string
): Promise<{ amount: string; rewardDebt: string }> => {
  try {
    // Query userInfo mapping from Cirrus
    // The mapping is indexed with key (poolId) and key2 (userAddress)
    const response = await cirrus.get(accessToken, `/${RewardsChef}-userInfo`, {
      params: {
        address: `eq.${rewardsChefAddress}`,
        key: `eq.${poolId}`,
        key2: `eq.${userAddress}`,
        select: "value",
        order: "block_timestamp.desc",
        limit: "1"
      }
    });

    const userInfo = response.data?.[0]?.value;
    return {
      amount: userInfo?.amount || "0",
      rewardDebt: userInfo?.rewardDebt || "0"
    };
  } catch (error) {
    console.error("Failed to fetch user info from RewardsChef:", error);
    return { amount: "0", rewardDebt: "0" };
  }
};
