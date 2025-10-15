import { cirrus } from "../../../utils/mercataApiHelper";
import { constants } from "../../../config/constants";
import { getTokenBalanceForUser } from "../../services/tokens.service";
import { RewardsPool } from "@mercata/shared-types";

const { RewardsChef } = constants;

/**
 * Low-level function to fetch pools from RewardsChef contract using Cirrus
 * with optional additional query parameters
 *
 * @param accessToken - User access token for authentication
 * @param rewardsChefAddress - Address of the RewardsChef contract
 * @param additionalParams - Optional additional Cirrus query parameters for filtering
 * @param includePeriods - Whether to include bonusPeriods in the result (default: false)
 * @returns Promise resolving to array of pool information
 */
export const getPoolsCirrus = async (
  accessToken: string,
  rewardsChefAddress: string,
  additionalParams?: Record<string, string>,
  includePeriods: boolean = false
): Promise<RewardsPool[]> => {
  try {
    const response = await cirrus.get(accessToken, `/${RewardsChef}-pools`, {
      params: {
        address: `eq.${rewardsChefAddress}`,
        ...additionalParams
      }
    });

    // Filter out entries with empty values and map to desired format
    const pools = response.data
      ?.filter((entry: any) => entry.value && entry.value !== "")
      .map((entry: any) => {
        const pool: any = {
          poolIdx: entry.key,
          lpToken: entry.value.lpToken,
          allocPoint: entry.value.allocPoint,
          accPerToken: entry.value.accPerToken,
          lastRewardTimestamp: entry.value.lastRewardTimestamp
        };

        // Include bonusPeriods if requested, sorted by startTimestamp
        if (includePeriods && entry.value.bonusPeriods) {
          pool.bonusPeriods = [...entry.value.bonusPeriods].sort(
            (a: any, b: any) => BigInt(a.startTimestamp) < BigInt(b.startTimestamp) ? -1 : 1
          );
        }

        return pool;
      }) || [];

    return pools;
  } catch (error) {
    console.error("Failed to fetch pools from RewardsChef:", error);
    return [];
  }
};

/**
 * Get user's info (staked balance and reward debt) from RewardsChef
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
 * Get user's staked balance from RewardsChef for a specific pool
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
 * Finds the RewardsChef pool for a given LP token address
 * Uses Cirrus filtering for efficient database-level query
 *
 * @param accessToken - User access token for authentication
 * @param rewardsChefAddress - Address of the RewardsChef contract
 * @param lpTokenAddress - Address of the LP token to find
 * @returns Promise resolving to the pool object, or undefined if not found
 */
export const findPoolByLpToken = async (
  accessToken: string,
  rewardsChefAddress: string,
  lpTokenAddress: string
): Promise<RewardsPool | undefined> => {
  const pools = await getPoolsCirrus(accessToken, rewardsChefAddress, {
    "value->>lpToken": `eq.${lpTokenAddress}`
  });
  return pools[0]; // Should return at most one pool
};

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
