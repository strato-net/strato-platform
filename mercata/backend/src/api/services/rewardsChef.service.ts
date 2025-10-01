import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";

const { RewardsChef } = constants;

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
