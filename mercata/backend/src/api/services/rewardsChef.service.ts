import { strato } from "../../utils/mercataApiHelper";
import { constants, rewardsChef as rewardsChefAddress, StratoPaths } from "../../config/constants";
import { getTokenBalanceForUser } from "./tokens.service";
import { getPoolsCirrus, getUserInfo } from "../helpers/rewards/rewardsChef.helpers";
import { pendingCataAll } from "../helpers/rewards/pending.helpers";
import {
  PendingRewardsData
} from "@mercata/shared-types";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";

const { RewardsChef } = constants;

export const getPendingCataAll = async (
  accessToken: string,
  rewardsChefAddress: string,
  userAddress: string
): Promise<PendingRewardsData> => {

   const pendingCata = await pendingCataAll(
     accessToken,
     rewardsChefAddress,
     userAddress
   );

   // Format with proper decimals (wei to CATA with 18 decimals)
   const pendingCataFormatted = (Number(pendingCata) / 1e18).toFixed(2);
   return {
     pendingCata,
     pendingCataFormatted
   };
};


/**
 * Helper function to get user's staked balance from RewardsChef
 *
 * This function queries the userInfo mapping from Cirrus to get the current staked balance.
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
}>> => {
  return getPoolsCirrus(accessToken, rewardsChefAddress);
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
): Promise<{
  poolIdx: number;
  lpToken: string;
  allocPoint: string;
  accPerToken: string;
  lastRewardTimestamp: string;
} | undefined> => {
  const pools = await getPoolsCirrus(accessToken, rewardsChefAddress, {
    "value->>lpToken": `eq.${lpTokenAddress}`
  });
  return pools[0]; // Should return at most one pool
};

/**
 * Calls claimAll on RewardsChef contract to claim all pending rewards from all pools
 *
 * @param accessToken - User access token for authentication
 * @param userAddress - Address of the user claiming rewards
 * @returns Promise resolving to transaction result
 */
export const claimAll = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  const builtTx = await buildFunctionTx({
    contractName: extractContractName(RewardsChef),
    contractAddress: rewardsChefAddress,
    method: "claimAll",
    args: {}
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};
