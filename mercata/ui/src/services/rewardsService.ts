import { api } from "@/lib/axios";
import { formatUnits } from "viem";
import { dummyRewardsState, dummyActivities, getDummyUserRewards } from "./rewardsDummyData";
import { safeBigInt } from "@/utils/numberUtils";

// Set this to true to use dummy data, false to use backend API
const USE_DUMMY_DATA = false;

export interface Activity {
  activityId: number;
  name: string;
  activityType: 0 | 1; // 0 = Position, 1 = OneTime
  emissionRate: string;
  accRewardPerStake: string;
  lastUpdateTime: string; // Changed to string to match backend
  totalStake: string;
  allowedCaller: string;
  sourceContract: string;
}

export interface RewardsUserInfo {
  stake: string;
  userIndex: string;
}

export interface RewardsState {
  rewardToken: string;
  rewardTokenSymbol: string | null;
  totalRewardsEmission: string;
  lastBlockHandled: string;
  activityCount: number;
  totalStake: string;
}

export interface UserRewardsData {
  unclaimedRewards: string;
  activities: Array<{
    activityId: number;
    userInfo: RewardsUserInfo;
    activity: Activity;
    personalEmissionRate: string; // User's personal emission rate (points per second) for this activity
  }>;
}


/**
 * Fetch global Rewards contract state
 */
export const fetchRewardsState = async (): Promise<RewardsState> => {
  
  if (USE_DUMMY_DATA) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(dummyRewardsState), 300);
    });
  }
  
  try {
    const response = await api.get<RewardsState>("/rewards/overview");
    return response.data;
  } catch (error) {
    console.error("Failed to fetch rewards overview from backend:", error);
    throw error;
  }
};

/**
 * Fetch all activities in the system (without user-specific data)
 */
export const fetchActivities = async (): Promise<Activity[]> => {
  if (USE_DUMMY_DATA) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(dummyActivities), 300);
    });
  }
  
  const response = await api.get(`/rewards/activities`);
  const activities = response.data;
  
  // Map backend response to frontend Activity interface
  return activities.map((activity: {
    activityId: number;
    name: string;
    activityType: number;
    emissionRate: string;
    accRewardPerStake: string;
    lastUpdateTime: string;
    totalStake: string;
    sourceContract: string;
  }): Activity => ({
    activityId: activity.activityId,
    name: activity.name,
    activityType: activity.activityType as 0 | 1,
    emissionRate: activity.emissionRate,
    accRewardPerStake: activity.accRewardPerStake,
    lastUpdateTime: activity.lastUpdateTime,
    totalStake: activity.totalStake,
    allowedCaller: "", // Not available in response
    sourceContract: activity.sourceContract,
  }));
};

/**
 * Fetch single activity by ID
 * TODO: Replace with actual API call once contract is deployed
 */
export const fetchActivity = async (activityId: number): Promise<Activity> => {
  // Return dummy data until contract is deployed
  const activity = dummyActivities.find((a) => a.activityId === activityId);
  if (!activity) {
    throw new Error(`Activity ${activityId} not found`);
  }
  return new Promise((resolve) => {
    setTimeout(() => resolve(activity), 300); // Simulate network delay
  });
  
  // Uncomment when contract is deployed:
  // const response = await api.get<Activity>(`/rewards/activities/${activityId}`);
  // return response.data;
};

/**
 * Fetch user's rewards data
 */
export const fetchUserRewards = async (userAddress: string): Promise<UserRewardsData> => {
  if (USE_DUMMY_DATA) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(getDummyUserRewards(userAddress)), 300);
    });
  }
  
  const response = await api.get(`/rewards/activities/${userAddress}`);
  const data = response.data;
  
  // Backend now returns { unclaimedRewards: string, activities: UserActivity[] }
  const unclaimedRewards = data.unclaimedRewards || "0";
  const activities = data.activities || [];
  
  // Transform the response to match UserRewardsData format
  return {
    unclaimedRewards,
    activities: activities.map((activity: {
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
    }) => ({
      activityId: activity.activityId,
      userInfo: {
        stake: activity.userStake,
        userIndex: activity.userIndex,
      },
      activity: {
        activityId: activity.activityId,
        name: activity.name,
        activityType: activity.activityType,
        emissionRate: activity.emissionRate,
        accRewardPerStake: activity.accRewardPerStake,
        lastUpdateTime: activity.lastUpdateTime,
        totalStake: activity.totalStake,
        allowedCaller: "", // Not in response
        sourceContract: activity.sourceContract,
      },
      personalEmissionRate: activity.personalEmissionRate,
    })),
  };
};

// Re-export safeBigInt from numberUtils for convenience
export { safeBigInt };

/**
 * Calculate pending rewards for a user in an activity
 */
export const calculatePendingRewards = (
  stake: string,
  accRewardPerStake: string,
  userIndex: string,
  precisionMultiplier: string = "1000000000000000000"
): string => {
  const stakeBig = safeBigInt(stake);
  if (stakeBig === 0n) return "0";

  const indexDelta = safeBigInt(accRewardPerStake) - safeBigInt(userIndex);
  const pending = (stakeBig * indexDelta) / safeBigInt(precisionMultiplier);

  return pending.toString();
};

/**
 * Calculate estimated rewards per day for a user
 */
export const calculateEstimatedRewardsPerDay = (
  userStake: string,
  totalStake: string,
  emissionRate: string
): string => {
  if (safeBigInt(totalStake) === 0n) return "0";
  
  const userStakeBig = safeBigInt(userStake);
  const totalStakeBig = safeBigInt(totalStake);
  const emissionRateBig = safeBigInt(emissionRate);
  const secondsPerDay = 86400n;

  // (userStake / totalStake) * emissionRate * secondsPerDay
  const rewardsPerDay = (userStakeBig * emissionRateBig * secondsPerDay) / totalStakeBig;
  
  return rewardsPerDay.toString();
};

/**
 * Remove trailing zeros from a decimal string
 */
const removeTrailingZeros = (value: string): string => {
  if (!value.includes('.')) return value;
  return value.replace(/\.?0+$/, '');
};

/**
 * Round a number based on its magnitude
 * - Default: round to 2 decimal places
 * - If < 0.01: extend precision up to 8 decimal places to show first significant digit
 * - If the number is extremely small (< 0.00000001): display "tiny"
 * - Removes trailing zeros
 */
export const roundByMagnitude = (value: string): string => {
  // Remove commas and any non-numeric characters (except decimal point and minus sign)
  // This handles cases where formatBalance adds commas (e.g., "1,508.882458")
  const cleanValue = value.toString().replace(/,/g, '').trim();
  const num = parseFloat(cleanValue);
  if (num === 0 || isNaN(num)) return "0";
  
  // If the number is extremely small (less than 0.00000001), display "tiny"
  if (num < 0.00000001) {
    return "tiny";
  }
  
  // Default: round to 2 decimal places
  if (num >= 0.01) {
    return removeTrailingZeros(num.toFixed(2));
  }
  
  // If < 0.01, extend precision up to 8 decimal places
  // Find first non-zero digit after decimal to determine precision
  const str = cleanValue.toString();
  const decimalIndex = str.indexOf('.');
  
  if (decimalIndex === -1) {
    return removeTrailingZeros(num.toFixed(2));
  }
  
  let firstNonZeroIndex = decimalIndex + 1;
  while (firstNonZeroIndex < str.length && str[firstNonZeroIndex] === '0') {
    firstNonZeroIndex++;
  }
  
  if (firstNonZeroIndex === str.length) {
    return "0";
  }
  
  // Calculate precision: position of first non-zero digit + 1, capped at 8
  const decimalPlaces = firstNonZeroIndex - decimalIndex + 1;
  const precision = Math.min(decimalPlaces, 8);
  
  return removeTrailingZeros(num.toFixed(precision));
};

/**
 * Helper function to add comma formatting to a rounded number string
 * Preserves special values like "tiny" and "?" and exact decimal places
 */
const formatWithCommas = (value: string): string => {
  if (value === "?" || value === "tiny" || value === "0") {
    return value;
  }
  
  // Remove any existing commas
  const cleaned = value.replace(/,/g, '');
  
  // Check if it's a valid number
  const num = parseFloat(cleaned);
  if (isNaN(num)) {
    return value; // Return as-is if not a valid number
  }
  
  // Count decimal places in the original string
  const decimalIndex = cleaned.indexOf('.');
  const hasDecimal = decimalIndex !== -1;
  const decimalPlaces = hasDecimal ? cleaned.length - decimalIndex - 1 : 0;
  
  // Format with commas, preserving exact decimal places
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
    useGrouping: true
  });
};

/**
 * Format emission rate to points per day
 */
export const formatEmissionRatePerDay = (emissionRatePerSecond: string): string => {
  // Return early if value is empty, "0", or invalid
  if (!emissionRatePerSecond || emissionRatePerSecond === "0" || emissionRatePerSecond === "") {
    return "0";
  }
  
  const rateBig = safeBigInt(emissionRatePerSecond);
  // If the BigInt value is 0, return early
  if (rateBig === 0n) {
    return "0";
  }
  
  const secondsPerDay = 86400n;
  const perDay = rateBig * secondsPerDay;
  const formatted = formatUnits(perDay, 18);
  const rounded = roundByMagnitude(formatted);
  return formatWithCommas(rounded);
};

/**
 * Format emission rate to points per week
 */
export const formatEmissionRatePerWeek = (emissionRatePerSecond: string): string => {
  // Return early if value is empty, "0", or invalid
  if (!emissionRatePerSecond || emissionRatePerSecond === "0" || emissionRatePerSecond === "") {
    return "0";
  }
  
  const rateBig = safeBigInt(emissionRatePerSecond);
  // If the BigInt value is 0, return early
  if (rateBig === 0n) {
    return "0";
  }
  
  const secondsPerWeek = 604800n; // 7 * 24 * 60 * 60
  const perWeek = rateBig * secondsPerWeek;
  const formatted = formatUnits(perWeek, 18);
  const rounded = roundByMagnitude(formatted);
  return formatWithCommas(rounded);
};

/**
 * Format a rounded value string with commas (for stake, rewards, etc.)
 * Exported for use in components
 */
export const formatRoundedWithCommas = (value: string): string => {
  return formatWithCommas(value);
};

/**
 * Claim all rewards for a user
 * Backend will handle the contract interaction
 */
export const claimAllRewards = async (userAddress: string): Promise<{ success: boolean; txHash?: string }> => {
  if (USE_DUMMY_DATA) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ success: true, txHash: "0x0000000000000000000000000000000000000000000000000000000000000000" });
      }, 1000);
    });
  }
  
  const response = await api.post("/rewards/claim-all");
  return response.data;
};

/**
 * Claim rewards for specific activities
 * Backend will handle the contract interaction
 */
export const claimRewards = async (userAddress: string, activityIds: number[]): Promise<{ success: boolean; txHash?: string }> => {
  if (USE_DUMMY_DATA) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ success: true, txHash: "0x0000000000000000000000000000000000000000000000000000000000000000" });
      }, 1000);
    });
  }
  
  // Use the first activityId for the claim endpoint (since it's /claim/:activityId)
  // TODO: Update backend to accept multiple activityIds or call multiple times
  if (activityIds.length === 0) {
    throw new Error("At least one activity ID is required");
  }
  
  const response = await api.post(`/rewards/claim/${activityIds[0]}`);
  return response.data;
};


