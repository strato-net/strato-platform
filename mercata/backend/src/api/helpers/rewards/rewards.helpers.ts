import { cirrus, bloc } from "../../../utils/mercataApiHelper";
import { constants } from "../../../config/constants";

const { Rewards } = constants;

/**
 * Cache for contract state to avoid multiple calls
 */
let contractStateCache: { address: string; state: any; timestamp: number } | null = null;
let pendingRequest: Promise<any> | null = null;
const CACHE_TTL = 5000; // 5 seconds cache

/**
 * Fetch contract state once and cache it
 * Uses promise caching to prevent concurrent duplicate requests
 */
export const fetchContractState = async (
  accessToken: string,
  rewardsAddress: string
): Promise<any> => {
  const now = Date.now();
  
  // Return cached state if it's still valid
  if (contractStateCache && 
      contractStateCache.address === rewardsAddress &&
      (now - contractStateCache.timestamp) < CACHE_TTL) {
    return contractStateCache.state;
  }

  // If there's already a pending request, wait for it
  if (pendingRequest) {
    return pendingRequest;
  }

  // Create new request and cache the promise
  pendingRequest = (async () => {
    try {
      const response = await bloc.get(accessToken, `/contracts/Rewards/${rewardsAddress}/state`);
      const state = response.data;
      
      // Cache the state
      contractStateCache = {
        address: rewardsAddress,
        state,
        timestamp: Date.now()
      };
      
      return state;
    } catch (error) {
      console.error("Failed to fetch Rewards contract state:", error);
      throw error;
    } finally {
      // Clear pending request after completion
      pendingRequest = null;
    }
  })();

  return pendingRequest;
};

/**
 * Calculate personal emission rate for a user in an activity
 * Formula: personalEmissionRate = activity.emissionRate * (userStake / totalStake)
 */
export const calculatePersonalEmissionRate = (
  userStake: string,
  totalStake: string,
  activityEmissionRate: string
): string => {
  const userStakeBig = BigInt(userStake);
  const totalStakeBig = BigInt(totalStake);
  
  if (userStakeBig === 0n || totalStakeBig === 0n) {
    return "0";
  }

  // personalEmissionRate = (userStake * activityEmissionRate) / totalStake
  const personalRate = (userStakeBig * BigInt(activityEmissionRate)) / totalStakeBig;
  
  return personalRate.toString();
};

/**
 * Fetch contract data from Rewards contract using cached state
 */
export const fetchRewardsContractData = async (
  accessToken: string,
  rewardsAddress: string
): Promise<{
  rewardToken: string;
  totalRewardsEmission: string;
  highestBlockSeen: string;
}> => {
  const state = await fetchContractState(accessToken, rewardsAddress);
  
  return {
    rewardToken: state?.rewardToken || "",
    totalRewardsEmission: state?.totalRewardsEmission || "0",
    highestBlockSeen: state?.highestBlockSeen || "0"
  };
};

/**
 * Fetch activityIds array from cached contract state
 */
export const fetchActivityIds = async (
  accessToken: string,
  rewardsAddress: string
): Promise<string[]> => {
  const state = await fetchContractState(accessToken, rewardsAddress);
  const activityIds = state?.activityIds || [];
  
  // Filter out entries where value is empty string or null
  return activityIds.filter((id: any) => id !== "" && id !== null && id !== undefined);
};

/**
 * Fetch all activities from cached contract state
 */
export const fetchActivities = async (
  accessToken: string,
  rewardsAddress: string
): Promise<Map<number, any>> => {
  const state = await fetchContractState(accessToken, rewardsAddress);
  const activities = state?.activities || {};
  
  const activitiesMap = new Map<number, any>();
  Object.keys(activities).forEach((activityIdStr: string) => {
    const activityId = parseInt(activityIdStr, 10);
    if (!isNaN(activityId)) {
      const activity = activities[activityIdStr];
      activitiesMap.set(activityId, {
        activityId,
        name: activity?.name || "",
        activityType: activity?.activityType || "0",
        emissionRate: activity?.emissionRate || "0",
        sourceContract: activity?.sourceContract || ""
      });
    }
  });

  return activitiesMap;
};

/**
 * Fetch all activity states from cached contract state
 */
export const fetchActivityStates = async (
  accessToken: string,
  rewardsAddress: string
): Promise<Map<number, any>> => {
  const state = await fetchContractState(accessToken, rewardsAddress);
  const activityStates = state?.activityStates || {};
  
  const groupedStates = new Map<number, any>();
  Object.keys(activityStates).forEach((activityIdStr: string) => {
    const activityId = parseInt(activityIdStr, 10);
    if (!isNaN(activityId)) {
      const activityState = activityStates[activityIdStr];
      groupedStates.set(activityId, {
        accRewardPerStake: activityState?.accRewardPerStake || "0",
        lastUpdateTime: activityState?.lastUpdateTime || "0",
        totalStake: activityState?.totalStake || "0"
      });
    }
  });

  return groupedStates;
};

/**
 * Fetch user info for a specific user from cached contract state
 */
export const fetchUserInfo = async (
  accessToken: string,
  rewardsAddress: string,
  userAddress: string,
  activityIds: number[]
): Promise<Map<number, { stake: string; userIndex: string }>> => {
  const state = await fetchContractState(accessToken, rewardsAddress);
  const userInfo = state?.userInfo?.[userAddress.toLowerCase()] || {};
  
  const userInfoMap = new Map<number, { stake: string; userIndex: string }>();
  
  activityIds.forEach((activityId: number) => {
    const activityUserInfo = userInfo[activityId.toString()] || {};
    userInfoMap.set(activityId, {
      stake: activityUserInfo?.stake || "0",
      userIndex: activityUserInfo?.userIndex || "0"
    });
  });

  return userInfoMap;
};

/**
 * Fetch unclaimed rewards for a specific user from cached contract state
 */
export const fetchUnclaimedRewards = async (
  accessToken: string,
  rewardsAddress: string,
  userAddress: string
): Promise<string> => {
  const state = await fetchContractState(accessToken, rewardsAddress);
  const unclaimedRewards = state?.unclaimedRewards || {};
  
  return unclaimedRewards[userAddress.toLowerCase()] || "0";
};

