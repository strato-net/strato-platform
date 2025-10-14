import { getTokenBalanceForUser } from "../../services/tokens.service";
import { getUserInfo, getRewardsChefState } from "./rewardsChef.helpers";

// PRECISION_MULTIPLIER from RewardsChef.sol
const PRECISION_MULTIPLIER = BigInt(1e18);

/**
 * Calculates the bonus-adjusted multiplier for a time period
 * Replicates the getMultiplier() logic from RewardsChef.sol
 *
 * @param bonusPeriods - Array of bonus periods sorted by startTimestamp
 * @param from - Start timestamp
 * @param to - End timestamp
 * @returns Bonus-adjusted time multiplier as BigInt
 */
const getMultiplier = (
  bonusPeriods: Array<{ startTimestamp: string; bonusMultiplier: string }>,
  from: bigint,
  to: bigint
): bigint => {
  if (from == to) {
    return 0n;
  }

  const MAX_INT = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  let totalMultipliedTime = 0n;
  let currentTime = from;

  for (let i = 0; i < bonusPeriods.length && currentTime < to; i++) {
    const periodStart = BigInt(bonusPeriods[i].startTimestamp);
    const periodEnd = (i + 1 < bonusPeriods.length)
      ? BigInt(bonusPeriods[i + 1].startTimestamp)
      : MAX_INT;

    if (currentTime < periodStart) {
      currentTime = periodStart;
    }

    if (currentTime < to && currentTime < periodEnd) {
      const segmentEnd = to < periodEnd ? to : periodEnd;
      const segmentDuration = segmentEnd - currentTime;
      totalMultipliedTime += segmentDuration * BigInt(bonusPeriods[i].bonusMultiplier);
      currentTime = segmentEnd;
    }
  }
  return totalMultipliedTime;
};

/**
 * Calculates pending CATA rewards for a user in a specific pool
 * Replicates the pendingCata() logic from RewardsChef.sol
 *
 * @param accessToken - User access token for authentication
 * @param rewardsChefAddress - Address of the RewardsChef contract
 * @param pool - Pool information including bonusPeriods (from getPoolsCirrus with includePeriods=true)
 * @param userAddress - User address to calculate rewards for
 * @returns Promise resolving to pending CATA amount as string
 */
export const pendingCata = async (
  accessToken: string,
  rewardsChefAddress: string,
  pool: {
    poolIdx: number;
    lpToken: string;
    allocPoint: string;
    accPerToken: string;
    lastRewardTimestamp: string;
    bonusPeriods?: Array<{ startTimestamp: string; bonusMultiplier: string }>;
  },
  userAddress: string
): Promise<string> => {
  try {
    // Get current timestamp in seconds
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

    // Get user info
    const userInfo = await getUserInfo(
      accessToken,
      rewardsChefAddress,
      pool.poolIdx,
      userAddress
    );

    // Get global state
    const globalState = await getRewardsChefState(accessToken, rewardsChefAddress);
    if (!globalState) {
      return "0";
    }

    // Start with current accPerToken
    let accPerToken = BigInt(pool.accPerToken);
    const lastRewardTimestamp = BigInt(pool.lastRewardTimestamp);

    // If time has passed since last reward and there are staked tokens, update accPerToken
    if (currentTimestamp > lastRewardTimestamp) {
      // Get LP token supply (balance of LP tokens held by RewardsChef contract)
      const lpSupply = BigInt(await getTokenBalanceForUser(accessToken, pool.lpToken, rewardsChefAddress));

      if (lpSupply !== 0n && pool.bonusPeriods && pool.bonusPeriods.length > 0) {
        // Calculate multiplier
        const multiplier = getMultiplier(pool.bonusPeriods, lastRewardTimestamp, currentTimestamp);

        // Calculate cataReward = (multiplier * cataPerSecond * allocPoint) / totalAllocPoint
        const cataReward =
          (multiplier * BigInt(globalState.cataPerSecond) * BigInt(pool.allocPoint)) /
          BigInt(globalState.totalAllocPoint);

        // Update accPerToken = accPerToken + (cataReward * PRECISION_MULTIPLIER) / lpSupply
        accPerToken += (cataReward * PRECISION_MULTIPLIER) / lpSupply;
      }
    }

    // Calculate pending = (user.amount * accPerToken / PRECISION_MULTIPLIER) - user.rewardDebt
    const userAmount = BigInt(userInfo.amount);
    const userRewardDebt = BigInt(userInfo.rewardDebt);
    const pending = (userAmount * accPerToken) / PRECISION_MULTIPLIER - userRewardDebt;

    return pending.toString();
  } catch (error) {
    console.error("Failed to calculate pending CATA:", error);
    return "0";
  }
};
