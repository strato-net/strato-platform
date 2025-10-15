import { strato } from "../../utils/mercataApiHelper";
import { constants, rewardsChef as rewardsChefAddress, StratoPaths } from "../../config/constants";
import { getTokenBalanceForUser } from "./tokens.service";
import * as Helpers from "../helpers/rewards/rewardsChef.helpers";
import { pendingCataAll } from "../helpers/rewards/pending.helpers";
import {
  PendingRewardsData,
  StakedBalanceData,
  RewardsPool
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
 * Get user's staked balance from RewardsChef for a specific pool
 *
 * This function queries the userInfo mapping from Cirrus to get the current staked balance
 * and returns a rich data object with both raw and formatted values.
 *
 * @param accessToken - User access token for authentication
 * @param rewardsChefAddress - Address of the RewardsChef contract
 * @param poolId - Pool ID to query
 * @param userAddress - User address to fetch balance for
 * @returns Promise resolving to staked balance data with formatted values
 */
export const getStakedBalanceForPool = async (
  accessToken: string,
  rewardsChefAddress: string,
  poolId: number,
  userAddress: string
): Promise<StakedBalanceData> => {
  const stakedBalance = await Helpers.getStakedBalance(accessToken, rewardsChefAddress, poolId, userAddress);

  // Format with proper decimals (wei to tokens with 18 decimals)
  const stakedBalanceFormatted = (Number(stakedBalance) / 1e18).toFixed(2);

  return {
    poolId,
    stakedBalance,
    stakedBalanceFormatted
  };
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
): Promise<RewardsPool[]> => {
  return Helpers.getPoolsCirrus(accessToken, rewardsChefAddress);
};

/**
 * Finds the RewardsChef pool for a given LP token address
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
  return Helpers.findPoolByLpToken(accessToken, rewardsChefAddress, lpTokenAddress);
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
