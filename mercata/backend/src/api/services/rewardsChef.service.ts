import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getTokenBalanceForUser } from "./tokens.service";

const { RewardsChef } = constants;

/**
 * Helper function to wait for Cirrus to index the new balance
 *
 * This addresses a race condition where a transaction is confirmed on-chain
 * but Cirrus hasn't indexed the new state yet. When querying immediately after
 * a transaction, Cirrus may return stale data.
 *
 * This is particularly important when:
 * - Depositing to Safety Module or Lending Pool (mints sToken/mToken)
 * - Then immediately staking those tokens to RewardsChef
 *
 * @param accessToken - User access token for authentication
 * @param tokenAddress - Address of the token to check balance for
 * @param userAddress - User address to check balance for
 * @param previousBalance - The balance before the transaction (in wei)
 * @param maxRetries - Maximum number of retry attempts (default: 10)
 * @param delayMs - Delay between retries in milliseconds (default: 200)
 * @returns Promise resolving to the updated balance as string (in wei)
 */
export const waitForBalanceUpdate = async (
  accessToken: string,
  tokenAddress: string,
  userAddress: string,
  previousBalance: string,
  maxRetries: number = 10,
  delayMs: number = 200
): Promise<string> => {
  for (let i = 0; i < maxRetries; i++) {
    const currentBalance = await getTokenBalanceForUser(accessToken, tokenAddress, userAddress);

    if (BigInt(currentBalance) > BigInt(previousBalance)) {
      return currentBalance;
    }

    // Wait before next retry
    if (i < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return previousBalance;
};

/**
 * Helper function to get user's info (staked balance and reward debt) from RewardsChef
 *
 * @param accessToken - User access token for authentication
 * @param rewardsChefAddress - Address of the RewardsChef contract
 * @param poolId - Pool ID to query
 * @param userAddress - User address to fetch info for
 * @returns Promise resolving to user info object
 */
export const getUserInfo = async (
  accessToken: string,
  rewardsChefAddress: string,
  poolId: number,
  userAddress: string
): Promise<{ amount: string; rewardDebt: string }> => {
  try {
    // Query userInfo mapping from Cirrus
    // The mapping is indexed with key (poolId) and key2 (userAddress)
    const response = await cirrus.get(accessToken, `/${RewardsChef}-userInfo`, {
      params: {
        address: `eq.${rewardsChefAddress}`,
        key: `eq.${poolId}`,
        key2: `eq.${userAddress}`,
        select: "value",
        order: "block_timestamp.desc",
        limit: "1"
      }
    });

    const userInfo = response.data?.[0]?.value;
    return {
      amount: userInfo?.amount || "0",
      rewardDebt: userInfo?.rewardDebt || "0"
    };
  } catch (error) {
    console.error("Failed to fetch user info from RewardsChef:", error);
    return { amount: "0", rewardDebt: "0" };
  }
};

/**
 * Helper function to get user's staked balance from RewardsChef
 * Backward compatibility wrapper for getUserInfo
 *
 * @param accessToken - User access token for authentication
 * @param rewardsChefAddress - Address of the RewardsChef contract
 * @param poolId - Pool ID to query
 * @param userAddress - User address to fetch balance for
 * @returns Promise resolving to staked balance as string (in wei)
 */
export const getStakedBalance = async (
  accessToken: string,
  rewardsChefAddress: string,
  poolId: number,
  userAddress: string
): Promise<string> => {
  const userInfo = await getUserInfo(accessToken, rewardsChefAddress, poolId, userAddress);
  return userInfo.amount;
};

/**
 * Fetches all pools from RewardsChef contract using Cirrus
 *
 * @param accessToken - User access token for authentication
 * @param rewardsChefAddress - Address of the RewardsChef contract
 * @returns Promise resolving to array of pool information
 */
export const getPools = async (
  accessToken: string,
  rewardsChefAddress: string
): Promise<Array<{
  poolIdx: number;
  lpToken: string;
  allocPoint: string;
  accPerToken: string;
  lastRewardTimestamp: string;
  bonusPeriods: Array<{ startTimestamp: string; bonusMultiplier: string }>;
}>> => {
  try {
    const response = await cirrus.get(accessToken, `/${RewardsChef}-pools`, {
      params: {
        address: `eq.${rewardsChefAddress}`,
        select: "key,value",
        order: "block_timestamp.desc"
      }
    });

    // Group by key (poolIdx) and take the latest entry for each pool
    const poolsMap = new Map();
    for (const entry of response.data || []) {
      if (entry.value && !poolsMap.has(entry.key)) {
        poolsMap.set(entry.key, {
          poolIdx: entry.key,
          lpToken: entry.value.lpToken,
          allocPoint: entry.value.allocPoint,
          accPerToken: entry.value.accPerToken,
          lastRewardTimestamp: entry.value.lastRewardTimestamp,
          bonusPeriods: entry.value.bonusPeriods || []
        });
      }
    }

    return Array.from(poolsMap.values()).sort((a, b) => a.poolIdx - b.poolIdx);
  } catch (error) {
    console.error("Failed to fetch pools from RewardsChef:", error);
    return [];
  }
};


/**
 * Calculates the bonus-adjusted multiplier for a time period
 * Replicates the getMultiplier() logic from RewardsChef.sol
 *
 * @param bonusPeriods - Array of bonus periods sorted by startTimestamp
 * @param from - Start timestamp
 * @param to - End timestamp
 * @returns Bonus-adjusted time multiplier as BigInt
 */
const calculateMultiplier = (
  bonusPeriods: Array<{ startTimestamp: string; bonusMultiplier: string }>,
  from: bigint,
  to: bigint
): bigint => {
  if (from >= to) {
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
 * Fetches RewardsChef global state (cataPerSecond and totalAllocPoint)
 *
 * @param accessToken - User access token for authentication
 * @param rewardsChefAddress - Address of the RewardsChef contract
 * @returns Promise resolving to global state
 */
export const getRewardsChefState = async (
  accessToken: string,
  rewardsChefAddress: string
): Promise<{ cataPerSecond: string; totalAllocPoint: string } | null> => {
  try {
    const response = await cirrus.get(accessToken, `/${RewardsChef}`, {
      params: {
        address: `eq.${rewardsChefAddress}`,
        select: "cataPerSecond::text,totalAllocPoint::text",
        order: "block_timestamp.desc",
        limit: "1"
      }
    });

    const state = response.data?.[0];
    if (!state) {
      return null;
    }

    return {
      cataPerSecond: state.cataPerSecond,
      totalAllocPoint: state.totalAllocPoint
    };
  } catch (error) {
    console.error("Failed to fetch RewardsChef state:", error);
    return null;
  }
};

/**
 * Calculates pending CATA rewards for a user in a specific pool
 * Replicates the pendingCata() logic from RewardsChef.sol
 *
 * This directly queries the userInfo mapping from Cirrus which contains both
 * the user's staked amount and their rewardDebt. This makes the calculation
 * accurate and simple.
 *
 * @param accessToken - User access token for authentication
 * @param rewardsChefAddress - Address of the RewardsChef contract
 * @param poolId - Pool ID
 * @param userAddress - User address to calculate rewards for
 * @param cataPerSecond - CATA tokens created per second (in wei)
 * @param totalAllocPoint - Sum of all allocation points across pools
 * @returns Promise resolving to pending CATA amount as string (in wei)
 */
export const calculatePendingCata = async (
  accessToken: string,
  rewardsChefAddress: string,
  poolId: number,
  userAddress: string,
  cataPerSecond: string,
  totalAllocPoint: string
): Promise<string> => {
  try {
    // Fetch pool data (includes bonusPeriods)
    const pools = await getPools(accessToken, rewardsChefAddress);
    const pool = pools.find(p => p.poolIdx === poolId);

    if (!pool) {
      return "0";
    }

    // Fetch user info (amount and rewardDebt)
    const userInfo = await getUserInfo(
      accessToken,
      rewardsChefAddress,
      poolId,
      userAddress
    );

    const userAmount = BigInt(userInfo.amount);
    if (userAmount === 0n) {
      return "0";
    }

    const userRewardDebt = BigInt(userInfo.rewardDebt);

    // Constants
    const PRECISION_MULTIPLIER = BigInt("1000000000000000000"); // 1e18
    const lastRewardTimestamp = BigInt(pool.lastRewardTimestamp);
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

    // Get LP token balance in the contract
    const lpSupply = await getTokenBalanceForUser(accessToken, pool.lpToken, rewardsChefAddress);
    const lpSupplyBigInt = BigInt(lpSupply);

    // Calculate current accPerToken (as pendingCata does in the contract)
    let accPerToken = BigInt(pool.accPerToken);

    // If time has passed since last pool update and there's liquidity, simulate the update
    if (currentTimestamp > lastRewardTimestamp && lpSupplyBigInt !== 0n) {
      const multiplier = calculateMultiplier(
        pool.bonusPeriods,
        lastRewardTimestamp,
        currentTimestamp
      );
      const cataReward = (
        multiplier *
        BigInt(cataPerSecond) *
        BigInt(pool.allocPoint)
      ) / BigInt(totalAllocPoint);

      accPerToken += (cataReward * PRECISION_MULTIPLIER) / lpSupplyBigInt;
    }

    // Calculate pending rewards: (user.amount * accPerToken) / PRECISION - user.rewardDebt
    const pending = (userAmount * accPerToken) / PRECISION_MULTIPLIER - userRewardDebt;

    // Ensure we don't return negative values
    return pending > 0n ? pending.toString() : "0";
  } catch (error) {
    console.error("Failed to calculate pending CATA:", error);
    return "0";
  }
};

/**
 * Calculates total pending CATA rewards for a user across all pools
 *
 * @param accessToken - User access token for authentication
 * @param rewardsChefAddress - Address of the RewardsChef contract
 * @param userAddress - User address to calculate rewards for
 * @returns Promise resolving to total pending CATA amount as string (in wei)
 */
export const calculateTotalPendingCata = async (
  accessToken: string,
  rewardsChefAddress: string,
  userAddress: string
): Promise<string> => {
  try {
    // Fetch global state
    const state = await getRewardsChefState(accessToken, rewardsChefAddress);
    if (!state) {
      return "0";
    }

    // Fetch all pools
    const pools = await getPools(accessToken, rewardsChefAddress);
    if (pools.length === 0) {
      return "0";
    }

    // Fetch all user positions (userInfo entries for this user)
    const userInfoResponse = await cirrus.get(accessToken, `/${RewardsChef}-userInfo`, {
      params: {
        address: `eq.${rewardsChefAddress}`,
        key2: `eq.${userAddress}`,
        select: "key,value",
        order: "block_timestamp.desc"
      }
    });

    // Group by pool ID (key) and take the latest entry for each pool
    const userPositionsMap = new Map();
    for (const entry of userInfoResponse.data || []) {
      const poolId = entry.key;
      if (!userPositionsMap.has(poolId) && entry.value?.amount !== "0") {
        userPositionsMap.set(poolId, entry.value);
      }
    }

    // If user has no positions, return 0
    if (userPositionsMap.size === 0) {
      return "0";
    }

    // Calculate pending for each pool the user has staked in
    let totalPending = 0n;

    for (const [poolId, _userInfo] of userPositionsMap) {
      const pending = await calculatePendingCata(
        accessToken,
        rewardsChefAddress,
        Number(poolId),
        userAddress,
        state.cataPerSecond,
        state.totalAllocPoint
      );

      totalPending += BigInt(pending);
    }

    return totalPending.toString();
  } catch (error) {
    console.error("Failed to calculate total pending CATA:", error);
    return "0";
  }
};
