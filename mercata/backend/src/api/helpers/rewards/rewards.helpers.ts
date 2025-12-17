import { cirrus, bloc } from "../../../utils/mercataApiHelper";
import { constants } from "../../../config/constants";


/**
 * Cache for contract state to avoid multiple calls
 */
let contractStateCache: { address: string; state: any; timestamp: number } | null = null;
let pendingRequest: Promise<any> | null = null;
const CACHE_TTL = 5000; // 5 seconds cache

/**
 * Cache for claimed rewards to avoid multiple cirrus event queries
 */
let claimedRewardsCache: { address: string; data: Map<string, bigint>; timestamp: number } | null = null;
let claimedRewardsPendingRequest: Promise<Map<string, bigint>> | null = null;

/**
 * Clear the contract state cache
 * Useful for forcing fresh data from the blockchain
 */
export const clearContractStateCache = (): void => {
  contractStateCache = null;
  pendingRequest = null;
};

/**
 * Clear the claimed rewards cache
 */
export const clearClaimedRewardsCache = (): void => {
  claimedRewardsCache = null;
  claimedRewardsPendingRequest = null;
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
 * Season info interface
 */
export interface SeasonInfo {
  currentSeason: number;
  seasonName: string;
  seasonTimestamp: number | null;
}

/**
 * Fetch current season info from contract state and SeasonAnnouncement events
 * 
 * Contract state: currentSeason (uint256) - starts at 1
 * Event: SeasonAnnouncement(uint256 indexed seasonId, string seasonName, uint256 timestamp)
 * Note: seasonName is NOT stored in state, only emitted in events.
 */
export const fetchSeasonInfo = async (
  accessToken: string,
  rewardsAddress: string,
  forceRefresh: boolean = false
): Promise<SeasonInfo> => {
  const state = await fetchContractState(accessToken, rewardsAddress, forceRefresh);
  
  // currentSeason is a public state variable in the contract (initialized to 1)
  const currentSeason = parseInt(state?.currentSeason || "1", 10);

  // Default season info (used if no SeasonAnnouncement event exists for this season)
  let seasonName = `Season ${currentSeason}`;
  let seasonTimestamp: number | null = null;

  try {
    // Fetch SeasonAnnouncement events to get season names
    // seasonName is only emitted in events, not stored in contract state
    const { data: events = [] } = await cirrus.get(accessToken, "/event", {
      params: {
        address: `eq.${rewardsAddress}`,
        event_name: `eq.SeasonAnnouncement`,
        select: "attributes,block_timestamp",
        order: "block_timestamp.desc",
        limit: 10,
      },
    });

    // Find the current season's announcement
    for (const event of events) {
      try {
        const attrs = typeof event.attributes === 'string' 
          ? JSON.parse(event.attributes) 
          : event.attributes || {};
        
        // Handle different attribute key formats (Cirrus may use _prefix for indexed params)
        const eventSeasonId = parseInt(
          attrs.seasonId || attrs._seasonId || attrs["0"] || "0", 
          10
        );
        const eventSeasonName = attrs.seasonName || attrs._seasonName || attrs["1"];
        const eventTimestamp = attrs.timestamp || attrs._timestamp || attrs["2"];
        
        if (eventSeasonId === currentSeason && eventSeasonName) {
          seasonName = eventSeasonName;
          seasonTimestamp = parseInt(eventTimestamp || "0", 10) || null;
          break;
        }
      } catch {
        // Skip invalid event
      }
    }
  } catch (error) {
    console.error("Failed to fetch SeasonAnnouncement events:", error);
    // Continue with default season name
  }

  return { currentSeason, seasonName, seasonTimestamp };
};

/**
 * Fetch total claimed rewards per user from RewardsClaimed events
 * Uses caching to avoid duplicate cirrus calls within CACHE_TTL
 * @param forceRefresh - If true, bypasses cache and fetches fresh data
 */
export const fetchClaimedRewards = async (
  accessToken: string,
  rewardsAddress: string,
  forceRefresh: boolean = false
): Promise<Map<string, bigint>> => {
  const now = Date.now();
  
  // Return cached data if valid and not forcing refresh
  if (!forceRefresh && claimedRewardsCache && 
      claimedRewardsCache.address === rewardsAddress &&
      (now - claimedRewardsCache.timestamp) < CACHE_TTL) {
    return claimedRewardsCache.data;
  }

  // Handle concurrent requests
  if (forceRefresh) {
    claimedRewardsCache = null;
    if (claimedRewardsPendingRequest) {
      return claimedRewardsPendingRequest;
    }
  } else {
    if (claimedRewardsPendingRequest) {
      return claimedRewardsPendingRequest;
    }
  }

  // Create new request and cache the promise
  claimedRewardsPendingRequest = (async () => {
  try {
    const { data: events = [] } = await cirrus.get(accessToken, "/event", {
      params: {
        address: `eq.${rewardsAddress}`,
        event_name: `eq.RewardsClaimed`,
        select: "attributes",
      },
    });

      const result = events.reduce((map: Map<string, bigint>, event: any) => {
      try {
        const attrs = typeof event.attributes === 'string' 
          ? JSON.parse(event.attributes) 
          : event.attributes || {};
        
        if (attrs.user && attrs.amount) {
          const user = attrs.user.toLowerCase();
          map.set(user, (map.get(user) || 0n) + BigInt(attrs.amount));
        }
      } catch {
        // Skip invalid event attributes
      }
      return map;
    }, new Map<string, bigint>());

      // Cache the result
      claimedRewardsCache = {
        address: rewardsAddress,
        data: result,
        timestamp: Date.now()
      };

      return result;
  } catch (error) {
    console.error("Failed to fetch claimed rewards:", error);
    return new Map<string, bigint>();
    } finally {
      claimedRewardsPendingRequest = null;
  }
  })();

  return claimedRewardsPendingRequest;
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
): Promise<Array<{ address: string; totalRewardsEarned: string }>> => {
  const state = await fetchContractState(accessToken, rewardsAddress, forceRefresh);
  const { userInfo = {}, unclaimedRewards = {}, activities = {}, activityStates = {} } = state || {};
  const claimedRewardsMap = await fetchClaimedRewards(accessToken, rewardsAddress, forceRefresh);
  const currentTime = Math.floor(Date.now() / 1000);
  const userSet = new Set<string>();

  // Process users with stake positions
  const usersWithStake = Object.entries(userInfo)
    .map(([userAddress, userActivities]) => {
      const totalPending = Object.entries(userActivities || {})
        .reduce((sum, [activityIdStr, userActivityInfo]) => {
          const activityId = parseInt(activityIdStr, 10);
          if (isNaN(activityId)) return sum;

          const activity = activities[activityIdStr];
          const activityState = activityStates[activityIdStr];
          if (!activity || !activityState || !userActivityInfo) return sum;

          const stake = BigInt(userActivityInfo.stake || "0");
          if (stake === 0n) return sum;

          const pending = calculateRealTimePendingRewards(
            userActivityInfo.stake || "0",
            activityState.accRewardPerStake || "0",
            userActivityInfo.userIndex || "0",
            activity.emissionRate || "0",
            activityState.totalStake || "0",
            activityState.lastUpdateTime || "0",
            currentTime
          );
          return sum + BigInt(pending);
        }, 0n);

      const unclaimed = BigInt(unclaimedRewards[userAddress] || "0");
      const claimed = claimedRewardsMap.get(userAddress.toLowerCase()) || 0n;
      const totalRewardsEarned = unclaimed + totalPending + claimed;

      if (totalRewardsEarned > 0n) {
        userSet.add(userAddress.toLowerCase());
        return { address: userAddress, totalRewardsEarned };
      }
      return null;
    })
    .filter((user): user is { address: string; totalRewardsEarned: bigint } => user !== null);

  // Add users with only claimed rewards (no current stake)
  const usersWithOnlyClaimed = Array.from(claimedRewardsMap.entries())
    .filter(([userAddress, claimed]) => 
      claimed > 0n && !userSet.has(userAddress.toLowerCase())
    )
    .map(([userAddress, claimed]) => ({ address: userAddress, totalRewardsEarned: claimed }));

  return [...usersWithStake, ...usersWithOnlyClaimed].map(user => ({
    address: user.address,
    totalRewardsEarned: user.totalRewardsEarned.toString(),
  }));
};

