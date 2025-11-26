import { api } from "@/lib/axios";
import { rewardsAddress } from "@/lib/constants";
import { REWARDS_ABI } from "@/lib/rewards/constants";
import { useWriteContract, useAccount } from "wagmi";
import { formatUnits } from "viem";
import { dummyRewardsState, dummyActivities, getDummyUserRewards } from "./rewardsDummyData";

export interface Activity {
  activityId: number;
  name: string;
  activityType: 0 | 1; // 0 = Position, 1 = OneTime
  emissionRate: string;
  accRewardPerStake: string;
  lastUpdateTime: number;
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
  totalRewardsEmission: string;
  lastBlockHandled: string;
  activityIds: number[];
}

export interface UserRewardsData {
  unclaimedRewards: string;
  activities: Array<{
    activityId: number;
    userInfo: RewardsUserInfo;
    activity: Activity;
  }>;
}

/**
 * Fetch global Rewards contract state
 * TODO: Replace with actual API call once contract is deployed
 */
export const fetchRewardsState = async (): Promise<RewardsState> => {
  // Return dummy data until contract is deployed
  return new Promise((resolve) => {
    setTimeout(() => resolve(dummyRewardsState), 300); // Simulate network delay
  });
  
  // Uncomment when contract is deployed:
  // const response = await api.get<RewardsState>("/rewards/state");
  // return response.data;
};

/**
 * Fetch all activities
 * TODO: Replace with actual API call once contract is deployed
 */
export const fetchActivities = async (): Promise<Activity[]> => {
  // Return dummy data until contract is deployed
  return new Promise((resolve) => {
    setTimeout(() => resolve(dummyActivities), 300); // Simulate network delay
  });
  
  // Uncomment when contract is deployed:
  // const response = await api.get<Activity[]>("/rewards/activities");
  // return response.data;
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
 * TODO: Replace with actual API call once contract is deployed
 */
export const fetchUserRewards = async (userAddress: string): Promise<UserRewardsData> => {
  // Return dummy data until contract is deployed
  return new Promise((resolve) => {
    setTimeout(() => resolve(getDummyUserRewards(userAddress)), 300); // Simulate network delay
  });
  
  // Uncomment when contract is deployed:
  // const response = await api.get<UserRewardsData>(`/rewards/user-info`, {
  //   params: { address: userAddress },
  // });
  // return response.data;
};

/**
 * Calculate pending rewards for a user in an activity
 */
export const calculatePendingRewards = (
  stake: string,
  accRewardPerStake: string,
  userIndex: string,
  precisionMultiplier: string = "1000000000000000000"
): string => {
  const stakeBig = BigInt(stake);
  if (stakeBig === 0n) return "0";

  const indexDelta = BigInt(accRewardPerStake) - BigInt(userIndex);
  const pending = (stakeBig * indexDelta) / BigInt(precisionMultiplier);

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
  if (BigInt(totalStake) === 0n) return "0";
  
  const userStakeBig = BigInt(userStake);
  const totalStakeBig = BigInt(totalStake);
  const emissionRateBig = BigInt(emissionRate);
  const secondsPerDay = 86400n;

  // (userStake / totalStake) * emissionRate * secondsPerDay
  const rewardsPerDay = (userStakeBig * emissionRateBig * secondsPerDay) / totalStakeBig;
  
  return rewardsPerDay.toString();
};

/**
 * Format emission rate to CATA per day
 */
export const formatEmissionRatePerDay = (emissionRatePerSecond: string): string => {
  const rateBig = BigInt(emissionRatePerSecond);
  const secondsPerDay = 86400n;
  const perDay = rateBig * secondsPerDay;
  return formatUnits(perDay, 18);
};

/**
 * Format emission rate to CATA per week
 */
export const formatEmissionRatePerWeek = (emissionRatePerSecond: string): string => {
  const rateBig = BigInt(emissionRatePerSecond);
  const secondsPerWeek = 604800n; // 7 * 24 * 60 * 60
  const perWeek = rateBig * secondsPerWeek;
  return formatUnits(perWeek, 18);
};

