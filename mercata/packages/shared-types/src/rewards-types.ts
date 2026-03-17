export interface PendingRewardsData {
  pendingCata: string;
  pendingCataFormatted: string;
}

export interface StakedBalanceData {
  poolId: number;
  stakedBalance: string;
  stakedBalanceFormatted: string;
}

export interface BonusPeriod {
  startTimestamp: string;
  bonusMultiplier: string;
}

export interface RewardsPool {
  poolIdx: number;
  lpToken: string;
  allocPoint: string;
  accPerToken: string;
  lastRewardTimestamp: string;
  bonusPeriods?: BonusPeriod[];
}
