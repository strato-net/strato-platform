import * as config from "../../config/config";
import { constants } from "../../config/constants";
import { cirrus } from "../../utils/mercataApiHelper";
import {
  calculatePersonalEmissionRate,
  fetchRewardsContractData,
  fetchActivityIds,
  fetchActivities,
  fetchActivityStates,
  fetchUserInfo,
  fetchUnclaimedRewards
} from "../helpers/rewards/rewards.helpers";

const { Token } = constants;

/**
 * Activity with user-specific data
 */
export interface UserActivity {
  activityId: number;
  name: string;
  activityType: number;
  emissionRate: string;
  accRewardPerStake: string;
  lastUpdateTime: string;
  totalStake: string;
  sourceContract: string;
  userStake: string;
  userIndex: string;
  personalEmissionRate: string;
}

/**
 * System-wide activity (without user-specific data)
 */
export interface SystemActivity {
  activityId: number;
  name: string;
  activityType: number;
  emissionRate: string;
  accRewardPerStake: string;
  lastUpdateTime: string;
  totalStake: string;
  sourceContract: string;
}

/**
 * Global Rewards contract overview data
 */
export interface RewardsOverview {
  rewardToken: string;
  rewardTokenSymbol: string | null;
  totalRewardsEmission: string;
  lastBlockHandled: string;
  activityCount: number;
  totalStake: string;
}

/**
 * Get global Rewards contract overview data
 * @param accessToken - Access token for authentication
 * @returns Rewards overview data
 */
export const fetchRewardsOverview = async (
  accessToken: string
): Promise<RewardsOverview> => {
  if (!config.rewards) {
    throw new Error("Rewards contract address not configured");
  }

  const rewardsAddress = config.rewards;

  try {
    // All these functions now use the same cached contract state, so they're fast
    const [contractData, activityIds, activityStatesMap] = await Promise.all([
      fetchRewardsContractData(accessToken, rewardsAddress),
      fetchActivityIds(accessToken, rewardsAddress),
      fetchActivityStates(accessToken, rewardsAddress)
    ]);

    // Sum up total stake across all activities
    let totalStake = BigInt(0);
    activityStatesMap.forEach((state: any) => {
      const stake = BigInt(state?.totalStake || "0");
      totalStake += stake;
    });

    // Fetch token symbol
    let rewardTokenSymbol: string | null = null;
    try {
      if (contractData.rewardToken) {
        const { data } = await cirrus.get(accessToken, `/${Token}`, {
          params: {
            address: "eq." + contractData.rewardToken,
            select: "_symbol",
          }
        });
        const token = data?.[0];
        rewardTokenSymbol = token?._symbol || null;
      }
    } catch (error) {
      console.error(`Error fetching token symbol for ${contractData.rewardToken}:`, error);
      // Continue without symbol, will be null
    }

    return {
      rewardToken: contractData.rewardToken,
      rewardTokenSymbol,
      totalRewardsEmission: contractData.totalRewardsEmission,
      lastBlockHandled: contractData.highestBlockSeen,
      activityCount: activityIds.length,
      totalStake: totalStake.toString()
    };
  } catch (error) {
    console.error("Failed to fetch Rewards overview:", error);
    throw error;
  }
};

/**
 * User activities response with unclaimed rewards
 */
export interface UserActivitiesResponse {
  unclaimedRewards: string;
  activities: UserActivity[];
}

/**
 * Get all activities with their states and user-specific data
 * @param accessToken - Access token for authentication
 * @param userAddress - User address to include user-specific data
 * @returns User activities response with unclaimed rewards
 */
export const fetchUserActivities = async (
  accessToken: string,
  userAddress: string
): Promise<UserActivitiesResponse> => {
  if (!config.rewards) {
    throw new Error("Rewards contract address not configured");
  }

  const rewardsAddress = config.rewards;

  try {
    // Fetch all activities and unclaimed rewards in parallel
    const activitiesMap = await fetchActivities(accessToken, rewardsAddress);
    const activities = Array.from(activitiesMap.values());

    if (activities.length === 0) {
      const unclaimedRewards = await fetchUnclaimedRewards(accessToken, rewardsAddress, userAddress);
      return {
        unclaimedRewards,
        activities: []
      };
    }

    const activityIds = activities.map((a: any) => a.activityId);

    // Batch fetch all activity states, user info, and unclaimed rewards in parallel
    const [activityStatesMap, userInfoMap, unclaimedRewards] = await Promise.all([
      fetchActivityStates(accessToken, rewardsAddress),
      fetchUserInfo(accessToken, rewardsAddress, userAddress, activityIds),
      fetchUnclaimedRewards(accessToken, rewardsAddress, userAddress)
    ]);

    // Combine all data
    const userActivities = activities.map((activity: any) => {
      const activityId = activity.activityId;
      const state = activityStatesMap.get(activityId);
      const userInfo = userInfoMap.get(activityId) || { stake: "0", userIndex: "0" };

      // Convert activityType from string to number (it comes as "0" or "1" or address string)
      let activityType = 0;
      if (activity.activityType) {
        const activityTypeStr = activity.activityType.toString();
        // If it's an address string (all zeros or non-numeric), treat as 0
        // Otherwise parse as number
        if (activityTypeStr === "1" || activityTypeStr === "0000000000000000000000000000000000000001") {
          activityType = 1;
        } else {
          activityType = 0;
        }
      }

      const baseActivity = {
        activityId,
        name: activity.name || "",
        activityType,
        emissionRate: activity.emissionRate || "0",
        accRewardPerStake: state?.accRewardPerStake || "0",
        lastUpdateTime: state?.lastUpdateTime || "0",
        totalStake: state?.totalStake || "0",
        sourceContract: activity.sourceContract || "",
      };

      const personalEmissionRate = calculatePersonalEmissionRate(
        userInfo.stake,
        baseActivity.totalStake,
        baseActivity.emissionRate
      );

      return {
        ...baseActivity,
        userStake: userInfo.stake,
        userIndex: userInfo.userIndex,
        personalEmissionRate
      };
    });

    return {
      unclaimedRewards,
      activities: userActivities
    };
  } catch (error) {
    console.error("Failed to fetch user activities:", error);
    throw error;
  }
};

/**
 * Get all activities in the system (without user-specific data)
 * @param accessToken - Access token for authentication
 * @returns Array of system activities
 */
export const fetchAllActivities = async (
  accessToken: string
): Promise<SystemActivity[]> => {
  if (!config.rewards) {
    throw new Error("Rewards contract address not configured");
  }

  const rewardsAddress = config.rewards;

  try {
    // Fetch all activities and their states
    const [activitiesMap, activityStatesMap] = await Promise.all([
      fetchActivities(accessToken, rewardsAddress),
      fetchActivityStates(accessToken, rewardsAddress)
    ]);

    const activities = Array.from(activitiesMap.values());

    if (activities.length === 0) {
      return [];
    }

    // Combine activities with their states
    return activities.map((activity: any) => {
      const activityId = activity.activityId;
      const state = activityStatesMap.get(activityId);

      // Convert activityType from string to number (it comes as "0" or "1" or address string)
      let activityType = 0;
      if (activity.activityType) {
        const activityTypeStr = activity.activityType.toString();
        // If it's an address string (all zeros or non-numeric), treat as 0
        // Otherwise parse as number
        if (activityTypeStr === "1" || activityTypeStr === "0000000000000000000000000000000000000001") {
          activityType = 1;
        } else {
          activityType = 0;
        }
      }

      return {
        activityId,
        name: activity.name || "",
        activityType,
        emissionRate: activity.emissionRate || "0",
        accRewardPerStake: state?.accRewardPerStake || "0",
        lastUpdateTime: state?.lastUpdateTime || "0",
        totalStake: state?.totalStake || "0",
        sourceContract: activity.sourceContract || "",
      };
    });
  } catch (error) {
    console.error("Failed to fetch all activities:", error);
    throw error;
  }
};


