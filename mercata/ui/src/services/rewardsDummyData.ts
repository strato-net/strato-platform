import { Activity, RewardsState, UserRewardsData } from "./rewardsService";

// Dummy data for Rewards contract (before deployment)
export const dummyRewardsState: RewardsState = {
  rewardToken: "2680dc6693021cd3fefb84351570874fbef8332a", // CATA address
  rewardTokenSymbol: "CATA",
  totalRewardsEmission: "10000000000000000", // 0.01 CATA per second (1e16)
  lastBlockHandled: "12345678",
  activityCount: 6,
  totalStake: "5000000000000000000000", // 5000 tokens total across all activities
};

export const dummyActivities: Activity[] = [
  {
    activityId: 1,
    name: "Normal Value (>= 0.01/day)",
    activityType: 0, // Position
    // emissionRate: 115740740740740 wei = 0.01 per day (should round to 2 decimals: 0.01)
    emissionRate: "115740740740740",
    accRewardPerStake: "50000000000000000000", // 50 CATA per stake (scaled by 1e18)
    lastUpdateTime: String(Math.floor(Date.now() / 1000) - 3600), // 1 hour ago
    totalStake: "1000000000000000000000", // 1000 tokens
    allowedCaller: "0000000000000000000000000000000000001001",
    sourceContract: "0000000000000000000000000000000000001002",
  },
  {
    activityId: 2,
    name: "Normal Value Large (>= 0.01/day)",
    activityType: 0, // Position
    // emissionRate: 1157407407407400 wei = 0.1 per day (should round to 2 decimals: 0.10)
    emissionRate: "1157407407407400",
    accRewardPerStake: "30000000000000000000", // 30 CATA per stake
    lastUpdateTime: String(Math.floor(Date.now() / 1000) - 1800), // 30 minutes ago
    totalStake: "500000000000000000000", // 500 tokens
    allowedCaller: "0000000000000000000000000000000000001001",
    sourceContract: "0000000000000000000000000000000000001002",
  },
  {
    activityId: 3,
    name: "Small Value (< 0.01/day)",
    activityType: 1, // OneTime
    // emissionRate: 115740740740 wei = 0.001 per day (should show extended precision: 0.001)
    emissionRate: "115740740740",
    accRewardPerStake: "15000000000000000000", // 15 CATA per stake
    lastUpdateTime: String(Math.floor(Date.now() / 1000) - 600), // 10 minutes ago
    totalStake: "2000000000000000000000", // 2000 tokens
    allowedCaller: "0000000000000000000000000000000000001003",
    sourceContract: "0000000000000000000000000000000000001004",
  },
  {
    activityId: 4,
    name: "Small Value Very Small (< 0.01/day)",
    activityType: 0, // Position
    // emissionRate: 1157407407 wei = 0.00001 per day (should show extended precision: 0.00001)
    emissionRate: "1157407407",
    accRewardPerStake: "80000000000000000000", // 80 CATA per stake
    lastUpdateTime: String(Math.floor(Date.now() / 1000) - 120), // 2 minutes ago
    totalStake: "3000000000000000000000", // 3000 tokens
    allowedCaller: "0000000000000000000000000000000000001015",
    sourceContract: "0000000000000000000000000000000000001015",
  },
  {
    activityId: 5,
    name: "Near Tiny But Visible",
    activityType: 0, // Position
    // emissionRate: 104166666 wei = 0.000000009 per day (should show extended precision: 0.000000009)
    emissionRate: "104166666",
    accRewardPerStake: "10000000000000000000", // 10 CATA per stake
    lastUpdateTime: String(Math.floor(Date.now() / 1000) - 60), // 1 minute ago
    totalStake: "1000000000000000000000", // 1000 tokens
    allowedCaller: "0000000000000000000000000000000000001001",
    sourceContract: "0000000000000000000000000000000000001002",
  },
  {
    activityId: 6,
    name: "Tiny Value (< 0.00000001/day)",
    activityType: 1, // OneTime
    // emissionRate: 11574074 wei = 0.000000001 per day (should show "tiny")
    emissionRate: "11574074",
    accRewardPerStake: "5000000000000000000", // 5 CATA per stake
    lastUpdateTime: String(Math.floor(Date.now() / 1000) - 30), // 30 seconds ago
    totalStake: "500000000000000000000", // 500 tokens
    allowedCaller: "0000000000000000000000000000000000001003",
    sourceContract: "0000000000000000000000000000000000001004",
  },
];

// Dummy user rewards data (for a sample user address)
export const getDummyUserRewards = (userAddress: string): UserRewardsData => {
  // Return different data based on user address to simulate different users
  const isActiveUser = userAddress.toLowerCase().includes("a") || userAddress.toLowerCase().includes("1");
  
  if (!isActiveUser) {
    return {
      unclaimedRewards: "0",
      activities: [],
    };
  }

  return {
    unclaimedRewards: "500000000000000000", // 0.5 CATA (settled)
    activities: [
      {
        activityId: 1,
        userInfo: {
          stake: "100000000000000000000", // 100 tokens
          userIndex: "45000000000000000000", // 45 CATA per stake (user's snapshot)
        },
        activity: dummyActivities[0],
      },
      {
        activityId: 2,
        userInfo: {
          stake: "50000000000000000000", // 50 tokens
          userIndex: "28000000000000000000", // 28 CATA per stake
        },
        activity: dummyActivities[1],
      },
      {
        activityId: 3,
        userInfo: {
          stake: "200000000000000000000", // 200 tokens
          userIndex: "14000000000000000000", // 14 CATA per stake
        },
        activity: dummyActivities[2],
      },
      {
        activityId: 4,
        userInfo: {
          stake: "150000000000000000000", // 150 tokens
          userIndex: "75000000000000000000", // 75 CATA per stake
        },
        activity: dummyActivities[3],
      },
      {
        activityId: 5,
        userInfo: {
          stake: "100000000000000000000", // 100 tokens
          userIndex: "9000000000000000000", // 9 CATA per stake
        },
        activity: dummyActivities[4],
      },
      {
        activityId: 6,
        userInfo: {
          stake: "50000000000000000000", // 50 tokens
          userIndex: "4000000000000000000", // 4 CATA per stake
        },
        activity: dummyActivities[5],
      },
    ],
  };
};


