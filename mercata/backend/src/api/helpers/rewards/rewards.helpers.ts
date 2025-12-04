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
 * Clear the contract state cache
 * Useful for forcing fresh data from the blockchain
 */
export const clearContractStateCache = (): void => {
  contractStateCache = null;
  pendingRequest = null;
};

/**
 * Fetch contract state once and cache it
 * Uses promise caching to prevent concurrent duplicate requests
 * @param forceRefresh - If true, bypasses cache and fetches fresh data
 */
export const fetchContractState = async (
  accessToken: string,
  rewardsAddress: string,
  forceRefresh: boolean = false
): Promise<any> => {
  const now = Date.now();
  
  // Return cached state if it's still valid and not forcing refresh
  if (!forceRefresh && contractStateCache && 
      contractStateCache.address === rewardsAddress &&
      (now - contractStateCache.timestamp) < CACHE_TTL) {
    return contractStateCache.state;
  }

  // If forcing refresh, clear cache but check if there's already a pending refresh request
  // This allows concurrent refresh requests to share the same blockchain call
  if (forceRefresh) {
    contractStateCache = null;
    // If there's already a pending request, it's likely a refresh - wait for it
    if (pendingRequest) {
      return pendingRequest;
    }
  } else {
    // If not forcing refresh and there's a pending request, wait for it
    if (pendingRequest) {
      return pendingRequest;
    }
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
 * Parse activityType from contract state to number
 * "OneTime" or "1" -> 1, otherwise -> 0 (Position)
 */
export const parseActivityType = (activityType: any): number => {
  if (!activityType) return 0;
  const activityTypeStr = String(activityType);
  return (activityTypeStr === "OneTime" || activityTypeStr === "1") ? 1 : 0;
};

/**
 * Calculate personal emission rate for a user in an activity (per second)
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
 * Calculate estimated rewards per day for a user in an activity
 * Formula: (userStake / totalStake) * emissionRate * secondsPerDay
 * This is equivalent to: calculatePersonalEmissionRate * 86400
 */
export const calculateEstimatedRewardsPerDay = (
  userStake: string,
  totalStake: string,
  activityEmissionRate: string
): string => {
  const userStakeBig = BigInt(userStake);
  const totalStakeBig = BigInt(totalStake);
  
  if (userStakeBig === 0n || totalStakeBig === 0n) {
    return "0";
  }

  const emissionRateBig = BigInt(activityEmissionRate);
  const secondsPerDay = 86400n;
  
  // (userStake / totalStake) * emissionRate * secondsPerDay
  const rewardsPerDay = (userStakeBig * emissionRateBig * secondsPerDay) / totalStakeBig;
  
  return rewardsPerDay.toString();
};

/**
 * Fetch contract data from Rewards contract using cached state
 */
export const fetchRewardsContractData = async (
  accessToken: string,
  rewardsAddress: string,
  forceRefresh: boolean = false
): Promise<{
  rewardToken: string;
  totalRewardsEmission: string;
  highestBlockSeen: string;
}> => {
  const state = await fetchContractState(accessToken, rewardsAddress, forceRefresh);
  
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
  rewardsAddress: string,
  forceRefresh: boolean = false
): Promise<string[]> => {
  const state = await fetchContractState(accessToken, rewardsAddress, forceRefresh);
  const activityIds = state?.activityIds || [];
  
  // Filter out entries where value is empty string or null
  return activityIds.filter((id: any) => id !== "" && id !== null && id !== undefined);
};

/**
 * Fetch all activities from cached contract state
 */
export const fetchActivities = async (
  accessToken: string,
  rewardsAddress: string,
  forceRefresh: boolean = false
): Promise<Map<number, any>> => {
  const state = await fetchContractState(accessToken, rewardsAddress, forceRefresh);
  const activities = state?.activities || {};
  
  const activitiesMap = new Map<number, any>();
  Object.keys(activities).forEach((activityIdStr: string) => {
    const activityId = parseInt(activityIdStr, 10);
    if (!isNaN(activityId)) {
      const activity = activities[activityIdStr];
      activitiesMap.set(activityId, {
        activityId,
        name: activity?.name || "",
        activityType: parseActivityType(activity?.activityType).toString(),
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
  rewardsAddress: string,
  forceRefresh: boolean = false
): Promise<Map<number, any>> => {
  const state = await fetchContractState(accessToken, rewardsAddress, forceRefresh);
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
  activityIds: number[],
  forceRefresh: boolean = false
): Promise<Map<number, { stake: string; userIndex: string }>> => {
  const state = await fetchContractState(accessToken, rewardsAddress, forceRefresh);
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
  userAddress: string,
  forceRefresh: boolean = false
): Promise<string> => {
  const state = await fetchContractState(accessToken, rewardsAddress, forceRefresh);
  const unclaimedRewards = state?.unclaimedRewards || {};
  
  return unclaimedRewards[userAddress.toLowerCase()] || "0";
};

/**
 * Calculate real-time pending rewards for a user in an activity
 */
export const calculateRealTimePendingRewards = (
  stake: string,
  accRewardPerStake: string,
  userIndex: string,
  emissionRate: string,
  totalStake: string,
  lastUpdateTime: string,
  currentTime: number,
  precisionMultiplier: string = "1000000000000000000"
): string => {
  const stakeBig = BigInt(stake);
  if (stakeBig === 0n) return "0";

  const lastUpdateBig = BigInt(lastUpdateTime);
  const currentTimeBig = BigInt(currentTime);
  
  if (currentTimeBig <= lastUpdateBig) {
    const indexDelta = BigInt(accRewardPerStake) - BigInt(userIndex);
    return ((stakeBig * indexDelta) / BigInt(precisionMultiplier)).toString();
  }

  const elapsed = currentTimeBig - lastUpdateBig;
  const totalStakeBig = BigInt(totalStake);
  if (totalStakeBig === 0n) {
    const indexDelta = BigInt(accRewardPerStake) - BigInt(userIndex);
    return ((stakeBig * indexDelta) / BigInt(precisionMultiplier)).toString();
  }

  const emissionRateBig = BigInt(emissionRate);
  const reward = emissionRateBig * elapsed;
  const indexIncrement = (reward * BigInt(precisionMultiplier)) / totalStakeBig;
  const realTimeIndex = BigInt(accRewardPerStake) + indexIncrement;
  const indexDelta = realTimeIndex - BigInt(userIndex);
  
  return ((stakeBig * indexDelta) / BigInt(precisionMultiplier)).toString();
};

/**
 * Fetch all users leaderboard data from cached contract state
 */
export const fetchAllUsersLeaderboard = async (
  accessToken: string,
  rewardsAddress: string,
  forceRefresh: boolean = false
): Promise<Array<{
  address: string;
  emissionRate: string;
  unclaimedRewards: string;
  pendingRewards: string;
}>> => {
  const state = await fetchContractState(accessToken, rewardsAddress, forceRefresh);
  const userInfo = state?.userInfo || {};
  const unclaimedRewards = state?.unclaimedRewards || {};
  const activities = state?.activities || {};
  const activityStates = state?.activityStates || {};
  
  const currentTime = Math.floor(Date.now() / 1000);
  const users: Array<{
    address: string;
    emissionRate: bigint;
    unclaimedRewards: bigint;
    pendingRewards: bigint;
  }> = [];

  // Process all users using Object.entries for cleaner iteration
  Object.entries(userInfo).forEach(([userAddress, userActivities]) => {
    const activitiesMap = userActivities || {};
    let totalEmissionRate = 0n;
    let totalPendingRewards = 0n;

    // Calculate emission rate and pending rewards across all activities
    Object.entries(activitiesMap).forEach(([activityIdStr, userActivityInfo]) => {
      const activityId = parseInt(activityIdStr, 10);
      if (isNaN(activityId)) return;

      const activity = activities[activityIdStr];
      const activityState = activityStates[activityIdStr];
      if (!activity || !activityState || !userActivityInfo) return;

      const userStake = userActivityInfo.stake || "0";
      const userIndex = userActivityInfo.userIndex || "0";
      const emissionRate = activity.emissionRate || "0";
      const totalStake = activityState.totalStake || "0";
      const accRewardPerStake = activityState.accRewardPerStake || "0";
      const lastUpdateTime = activityState.lastUpdateTime || "0";

      // Calculate personal emission rate using helper
      const personalEmissionRate = calculatePersonalEmissionRate(userStake, totalStake, emissionRate);
      if (personalEmissionRate !== "0") {
        totalEmissionRate += BigInt(personalEmissionRate);
      }

      // Calculate pending rewards
      const userStakeBig = BigInt(userStake);
      if (userStakeBig > 0n) {
        const pending = calculateRealTimePendingRewards(
          userStake,
          accRewardPerStake,
          userIndex,
          emissionRate,
          totalStake,
          lastUpdateTime,
          currentTime
        );
        totalPendingRewards += BigInt(pending);
      }
    });

    const unclaimed = BigInt(unclaimedRewards[userAddress] || "0");
    const totalRewards = unclaimed + totalPendingRewards;

    // Only include users with rewards or stake
    if (totalEmissionRate > 0n || totalRewards > 0n) {
      users.push({
        address: userAddress,
        emissionRate: totalEmissionRate,
        unclaimedRewards: unclaimed,
        pendingRewards: totalPendingRewards,
      });
    }
  });


  // Convert to strings and return
  return users.map((user) => ({
    address: user.address,
    emissionRate: user.emissionRate.toString(),
    unclaimedRewards: user.unclaimedRewards.toString(),
    pendingRewards: user.pendingRewards.toString(),
  }));
};

