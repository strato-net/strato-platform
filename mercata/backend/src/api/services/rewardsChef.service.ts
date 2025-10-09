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
 * Helper function to get user's staked balance from RewardsChef using Cirrus events
 *
 * This function queries the latest CurrentUserAmount event for the given user and pool,
 * which contains the current staked balance. This approach avoids on-chain calls while
 * working around the limitation that nested mappings cannot be queried from Cirrus.
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
  try {
    // Query the latest CurrentUserAmount event for this user and pool
    const response = await cirrus.get(accessToken, `/${RewardsChef}-CurrentUserAmount`, {
      params: {
        address: `eq.${rewardsChefAddress}`,
        user: `eq.${userAddress}`,
        pid: `eq.${poolId}`,
        select: "currentAmount::text,block_timestamp",
        order: "block_timestamp.desc",
        limit: "1"
      }
    });

    // Extract the current amount from the latest event
    const latestEvent = response.data?.[0];
    return latestEvent?.currentAmount || "0";
  } catch (error) {
    console.error("Failed to fetch staked balance from RewardsChef events:", error);
    return "0";
  }
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
}>> => {
  try {
    const response = await cirrus.get(accessToken, `/${RewardsChef}-pools`, {
      params: {
        address: `eq.${rewardsChefAddress}`
      }
    });

    // Filter out entries with empty values and map to desired format
    const pools = response.data
      ?.filter((entry: any) => entry.value && entry.value !== "")
      .map((entry: any) => ({
        poolIdx: entry.key,
        lpToken: entry.value.lpToken,
        allocPoint: entry.value.allocPoint,
        accPerToken: entry.value.accPerToken,
        lastRewardTimestamp: entry.value.lastRewardTimestamp
      })) || [];

    return pools;
  } catch (error) {
    console.error("Failed to fetch pools from RewardsChef:", error);
    return [];
  }
};
