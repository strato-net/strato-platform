import * as config from "../../config/config";
import { constants } from "../../config/constants";
import { cirrus } from "../../utils/mercataApiHelper";
import {
  calculatePersonalEmissionRate,
  parseActivityType,
  fetchRewardsContractData,
  fetchActivityIds,
  fetchActivities,
  fetchActivityStates,
  fetchUserInfo,
  fetchUnclaimedRewards,
  fetchAllUsersLeaderboard
} from "../helpers/rewards/rewards.helpers";

const { Token } = constants;

/**
 * Get rewards contract address or throw error
 */
const getRewardsAddress = (): string => {
  if (!config.rewards) {
    throw new Error("Rewards contract address not configured");
  }
  return config.rewards;
};

/**
 * Compare two BigInt values for sorting (returns -1, 0, or 1)
 */
const compareBigInt = (a: bigint, b: bigint): number => {
  return a < b ? 1 : a > b ? -1 : 0;
};

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
 * @param forceRefresh - If true, bypasses cache and fetches fresh data from blockchain
 * @returns Rewards overview data
 */
export const fetchRewardsOverview = async (
  accessToken: string,
  forceRefresh: boolean = false
): Promise<RewardsOverview> => {
  const rewardsAddress = getRewardsAddress();

  try {
    // All these functions now use the same cached contract state, so they're fast
    const [contractData, activityIds, activityStatesMap] = await Promise.all([
      fetchRewardsContractData(accessToken, rewardsAddress, forceRefresh),
      fetchActivityIds(accessToken, rewardsAddress, forceRefresh),
      fetchActivityStates(accessToken, rewardsAddress, forceRefresh)
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
 * @param forceRefresh - If true, bypasses cache and fetches fresh data from blockchain
 * @returns User activities response with unclaimed rewards
 */
export const fetchUserActivities = async (
  accessToken: string,
  userAddress: string,
  forceRefresh: boolean = false
): Promise<UserActivitiesResponse> => {
  const rewardsAddress = getRewardsAddress();

  try {
    // Fetch all activities and unclaimed rewards in parallel
    const activitiesMap = await fetchActivities(accessToken, rewardsAddress, forceRefresh);
    const activities = Array.from(activitiesMap.values());

    if (activities.length === 0) {
      const unclaimedRewards = await fetchUnclaimedRewards(accessToken, rewardsAddress, userAddress, forceRefresh);
      return {
        unclaimedRewards,
        activities: []
      };
    }

    const activityIds = activities.map((a: any) => a.activityId);

    // Batch fetch all activity states, user info, and unclaimed rewards in parallel
    const [activityStatesMap, userInfoMap, unclaimedRewards] = await Promise.all([
      fetchActivityStates(accessToken, rewardsAddress, forceRefresh),
      fetchUserInfo(accessToken, rewardsAddress, userAddress, activityIds, forceRefresh),
      fetchUnclaimedRewards(accessToken, rewardsAddress, userAddress, forceRefresh)
    ]);

    // Combine all data
    const userActivities = activities.map((activity: any) => {
      const activityId = activity.activityId;
      const state = activityStatesMap.get(activityId);
      const userInfo = userInfoMap.get(activityId) || { stake: "0", userIndex: "0" };

      const baseActivity = {
        activityId,
        name: activity.name || "",
        activityType: parseActivityType(activity.activityType),
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
 * @param forceRefresh - If true, bypasses cache and fetches fresh data from blockchain
 * @returns Array of system activities
 */
export const fetchAllActivities = async (
  accessToken: string,
  forceRefresh: boolean = false
): Promise<SystemActivity[]> => {
  const rewardsAddress = getRewardsAddress();

  try {
    // Fetch all activities and their states
    const [activitiesMap, activityStatesMap] = await Promise.all([
      fetchActivities(accessToken, rewardsAddress, forceRefresh),
      fetchActivityStates(accessToken, rewardsAddress, forceRefresh)
    ]);

    const activities = Array.from(activitiesMap.values());

    if (activities.length === 0) {
      return [];
    }

    // Combine activities with their states
    return activities.map((activity: any) => {
      const activityId = activity.activityId;
      const state = activityStatesMap.get(activityId);

      return {
        activityId,
        name: activity.name || "",
        activityType: parseActivityType(activity.activityType),
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

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  rank: number;
  address: string;
  emissionRate: string;
  unclaimedRewards: string;
  pendingRewards: string;
}

/**
 * Leaderboard response with pagination info
 */
export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total: number;
  offset: number;
  limit: number;
}

export const fetchLeaderboard = async (
  accessToken: string,
  forceRefresh: boolean = false,
  limit: number = 10,
  offset: number = 0,
  sortBy: "rewards" | "emissionRate" = "rewards"
): Promise<LeaderboardResponse> => {
  const rewardsAddress = getRewardsAddress();

  try {
    const users = await fetchAllUsersLeaderboard(accessToken, rewardsAddress, forceRefresh);

    // Sort users
    const sorted = users.sort((a, b) => {
      if (sortBy === "emissionRate") {
        return compareBigInt(BigInt(a.emissionRate), BigInt(b.emissionRate));
      }
      const totalA = BigInt(a.unclaimedRewards) + BigInt(a.pendingRewards);
      const totalB = BigInt(b.unclaimedRewards) + BigInt(b.pendingRewards);
      return compareBigInt(totalA, totalB);
    });

    const total = sorted.length;
    const paginated = sorted.slice(offset, offset + limit);

    // Assign ranks and map entries
    const entries = paginated.map((entry, index) => ({
      rank: offset + index + 1,
      ...entry,
    }));

    return { entries, total, offset, limit };
  } catch (error) {
    console.error("Failed to fetch leaderboard:", error);
    throw error;
  }
};


