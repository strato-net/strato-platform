import * as config from "../../config/config";
import { constants } from "../../config/constants";
import { cirrus } from "../../utils/mercataApiHelper";
import stakeSemanticsConfig from "./rewardsStakeSemantics.json";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { getSafetyModuleConfig } from "./safety.service";
import { getVaultShareTokenAddress } from "./vault.service";
import {
  calculatePersonalEmissionRate,
  parseActivityType,
  fetchRewardsContractData,
  fetchActivityIds,
  fetchActivities,
  fetchActivityStates,
  fetchUserInfo,
  fetchUnclaimedRewards,
  fetchClaimedRewards,
  fetchAllUsersLeaderboard
} from "../helpers/rewards/rewards.helpers";

const { Token, LendingPool, lendingRegistry, DECIMALS } = constants;
const ONE_USD_WEI = (10n ** 18n).toString();

const mulDiv1e18 = (amountWei: string, priceWei: string): string => {
  const amount = BigInt(amountWei || "0");
  const price = BigInt(priceWei || "0");
  if (amount === 0n || price === 0n) return "0";
  return ((amount * price) / (10n ** 18n)).toString();
};

export type StakeDenomination = "token_units" | "usd_notional" | "unknown";

type StakeSemanticsConfig = {
  usd_notional: {
    swapSources: string[];
    depositCompletedSources: string[];
    amountUsdSources: string[];
  };
  token_units: {
    lpMintBurnSources: string[];
  };
};

const normalizeAddr = (a: string): string => a.toLowerCase();

const STAKE_SEMANTICS: StakeSemanticsConfig = stakeSemanticsConfig as StakeSemanticsConfig;

const USD_NOTIONAL_SWAP_SOURCES = new Set<string>(STAKE_SEMANTICS.usd_notional.swapSources.map(normalizeAddr));
const USD_NOTIONAL_DEPOSIT_COMPLETED_SOURCES = new Set<string>(STAKE_SEMANTICS.usd_notional.depositCompletedSources.map(normalizeAddr));
const USD_NOTIONAL_AMOUNT_USD_SOURCES = new Set<string>(STAKE_SEMANTICS.usd_notional.amountUsdSources.map(normalizeAddr));
const TOKEN_UNITS_SOURCES = new Set<string>(STAKE_SEMANTICS.token_units.lpMintBurnSources.map(normalizeAddr));

const inferStakeSemantics = (activity: {
  name?: string;
  activityType?: number;
  sourceContract?: string;
}): { stakeDenomination: StakeDenomination; stakeAssetAddress: string | null } => {
  const sourceContract = (activity.sourceContract || "").toLowerCase();

  /**
   * Stake semantics are configured in `rewardsStakeSemantics.json` (derived from rewards-poller):
   * - Swap: USD-notional (amountIn * oracle(tokenIn))
   * - DepositCompleted: USD-notional (stratoTokenAmount * oracle(stratoToken)) but only when stratoToken == USDST
   * - USDSTMinted/Burned: amountUSD from payload (USD-denominated units)
   * - LP Minted/Burned: Token-Transfer value (LP token units)
   */

  const isUsdNotional =
    USD_NOTIONAL_SWAP_SOURCES.has(sourceContract) ||
    USD_NOTIONAL_DEPOSIT_COMPLETED_SOURCES.has(sourceContract) ||
    USD_NOTIONAL_AMOUNT_USD_SOURCES.has(sourceContract);

  if (isUsdNotional) {
    return { stakeDenomination: "usd_notional", stakeAssetAddress: null };
  }

  // For everything else, the poller passes through raw units. Sometimes those units are
  // token quantities (e.g. LP token transfer `value`), but sometimes they're shares or
  // protocol-specific units. We only confidently mark token_units when the source itself
  // is the token contract (LP token mint/burn is tracked via Token-Transfer on that token).
  if (TOKEN_UNITS_SOURCES.has(sourceContract)) {
    return { stakeDenomination: "token_units", stakeAssetAddress: sourceContract };
  }

  // Default: unknown units (do not imply token address).
  return { stakeDenomination: "unknown", stakeAssetAddress: null };
};



const getMTokenAddress = async (accessToken: string): Promise<string | null> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${LendingPool}`, {
      params: {
        select: "mToken",
        registry: `eq.${lendingRegistry}`,
        order: "block_timestamp.desc",
        limit: "1",
      }
    });
    return data?.[0]?.mToken || null;
  } catch {
    return null;
  }
};

type StakeUsdInfo = {
  stakeUnitPriceUsd: string | null; // 1e18-scaled USD per 1 stake unit
  totalStakeUsd: string | null;     // 1e18-scaled USD value of totalStake
  userStakeUsd?: string | null;     // 1e18-scaled USD value of userStake (only for user endpoints)
};

const inferStakeUsdInfo = (
  ctx: {
    priceMap: Map<string, string>;
    mTokenAddress: string | null;
    sTokenAddress: string | null;
    vaultShareTokenAddress: string | null;
  },
  baseActivity: { name: string; sourceContract: string; totalStake: string; stakeDenomination: StakeDenomination; stakeAssetAddress: string | null },
  userStakeWei?: string
): StakeUsdInfo => {
  // Default: no USD info
  const empty: StakeUsdInfo = { stakeUnitPriceUsd: null, totalStakeUsd: null, userStakeUsd: userStakeWei ? null : undefined };

  // If poller already posts USD-notional stake, unit price is 1 and USD value == stake value.
  if (baseActivity.stakeDenomination === "usd_notional") {
    return {
      stakeUnitPriceUsd: ONE_USD_WEI,
      totalStakeUsd: baseActivity.totalStake || "0",
      userStakeUsd: userStakeWei ?? undefined,
    };
  }

  // 1) Swap LP token mint/burn: stakeAssetAddress is the LP token contract itself.
  if (baseActivity.stakeAssetAddress) {  
    const price =
      ctx.priceMap.get(baseActivity.stakeAssetAddress.toLowerCase()) ||
      ctx.priceMap.get(baseActivity.stakeAssetAddress) ||
      null;
    if (price) {
      return {
        stakeUnitPriceUsd: price,
        totalStakeUsd: mulDiv1e18(baseActivity.totalStake, price),
        userStakeUsd: userStakeWei ? mulDiv1e18(userStakeWei, price) : undefined,
      };
    }
  }

  // 2) Safety Module: stake is sUSDST shares (priced via calculateSTokenPrice in getCompletePriceMap)
  // 3) Lending Pool Liquidity: stake is mToken shares (priced via getExchangeRateFromCirrus in getCompletePriceMap)
  // We infer these from activity name, since Rewards stake units are abstract and multiple activities can share a sourceContract.
  const lower = (baseActivity.name || "").toLowerCase();

  if (lower.includes("safety")) {
    const sTokenAddr = (ctx.sTokenAddress || "").toLowerCase();
    const price = sTokenAddr ? (ctx.priceMap.get(sTokenAddr) || null) : null;
    if (price) {
      return {
        stakeUnitPriceUsd: price,
        totalStakeUsd: mulDiv1e18(baseActivity.totalStake, price),
        userStakeUsd: userStakeWei ? mulDiv1e18(userStakeWei, price) : undefined,
      };
    }
  }

  if (lower.includes("lending pool liquidity")) {
    const mTokenAddr = (ctx.mTokenAddress || "").toLowerCase();
    const price = mTokenAddr ? (ctx.priceMap.get(mTokenAddr) || null) : null;
    if (price) {
      return {
        stakeUnitPriceUsd: price,
        totalStakeUsd: mulDiv1e18(baseActivity.totalStake, price),
        userStakeUsd: userStakeWei ? mulDiv1e18(userStakeWei, price) : undefined,
      };
    }
  }

  // 4) Lending Pool Borrow: stake is USDST amount (assumed always USDST per user guidance)
  if (lower.includes("borrow")) {
    return {
      stakeUnitPriceUsd: ONE_USD_WEI,
      totalStakeUsd: baseActivity.totalStake || "0",
      userStakeUsd: userStakeWei ?? undefined,
    };
  }

  // 5) Vault Token: stake is SLP shares (priced via getVaultShareTokenPrice in getCompletePriceMap)
  if (lower.includes("vault")) {
    const vaultAddr = (ctx.vaultShareTokenAddress || "").toLowerCase();
    const price = vaultAddr ? (ctx.priceMap.get(vaultAddr) || null) : null;
    if (price) {
      return {
        stakeUnitPriceUsd: price,
        totalStakeUsd: mulDiv1e18(baseActivity.totalStake, price),
        userStakeUsd: userStakeWei ? mulDiv1e18(userStakeWei, price) : undefined,
      };
    }
  }

  return empty;
};

/**
 * Get rewards contract address or throw error
 */
const getRewardsAddress = (): string => {
  if (!config.rewards) {
    throw new Error("Rewards contract address not configured");
  }
  return config.rewards;
};

/**
 * Compare two BigInt values for sorting (returns -1, 0, or 1)
 */
const compareBigInt = (a: bigint, b: bigint): number => {
  return a < b ? 1 : a > b ? -1 : 0;
};

/**
 * Activity with user-specific data
 */
export interface UserActivity {
  activityId: number;
  name: string;
  activityType: number;
  emissionRate: string;
  accRewardPerStake: string;
  lastUpdateTime: string;
  totalStake: string;
  totalStakeUsd: string | null;
  sourceContract: string;
  stakeDenomination: StakeDenomination;
  stakeAssetAddress: string | null;
  stakeUnitPriceUsd: string | null;
  userStake: string;
  userStakeUsd: string | null;
  userIndex: string;
  personalEmissionRate: string;
}

/**
 * System-wide activity (without user-specific data)
 */
export interface SystemActivity {
  activityId: number;
  name: string;
  activityType: number;
  emissionRate: string;
  accRewardPerStake: string;
  lastUpdateTime: string;
  totalStake: string;
  totalStakeUsd: string | null;
  sourceContract: string;
  stakeDenomination: StakeDenomination;
  stakeAssetAddress: string | null;
  stakeUnitPriceUsd: string | null;
}

/**
 * Global Rewards contract overview data
 */
export interface RewardsOverview {
  rewardToken: string;
  rewardTokenSymbol: string | null;
  totalRewardsEmission: string;
  lastBlockHandled: string;
  activityCount: number;
  totalStake: string;
  totalDistributed: string; // Sum of all users' (unclaimed + pending + claimed) rewards
  currentSeason: number;
}

/**
 * Get global Rewards contract overview data
 * @param accessToken - Access token for authentication
 * @param forceRefresh - If true, bypasses cache and fetches fresh data from blockchain
 * @returns Rewards overview data
 */
export const fetchRewardsOverview = async (
  accessToken: string,
  forceRefresh: boolean = false
): Promise<RewardsOverview> => {
  const rewardsAddress = getRewardsAddress();

  try {
    // All these functions now use the same cached contract state, so they're fast
    // fetchAllUsersLeaderboard also uses cached contract state + cached claimed rewards
    const [contractData, activityIds, activityStatesMap, allUsersLeaderboard] = await Promise.all([
      fetchRewardsContractData(accessToken, rewardsAddress, forceRefresh),
      fetchActivityIds(accessToken, rewardsAddress, forceRefresh),
      fetchActivityStates(accessToken, rewardsAddress, forceRefresh),
      fetchAllUsersLeaderboard(accessToken, rewardsAddress, forceRefresh)
    ]);

    // Hardcoded season info for now
    const currentSeason = 1;


    // Sum up total stake across all activities
    let totalStake = BigInt(0);
    activityStatesMap.forEach((state: any) => {
      const stake = BigInt(state?.totalStake || "0");
      totalStake += stake;
    });

    // Sum up total distributed (all users' unclaimed + pending + claimed rewards)
    let totalDistributed = BigInt(0);
    allUsersLeaderboard.forEach((user) => {
      totalDistributed += BigInt(user.totalRewardsEarned);
    });

    // Fetch token symbol
    let rewardTokenSymbol: string | null = null;
    try {
      if (contractData.rewardToken) {
        const { data } = await cirrus.get(accessToken, `/${Token}`, {
          params: {
            address: "eq." + contractData.rewardToken,
            select: "_symbol",
          }
        });
        const token = data?.[0];
        rewardTokenSymbol = token?._symbol || null;
      }
    } catch (error) {
      console.error(`Error fetching token symbol for ${contractData.rewardToken}:`, error);
      // Continue without symbol, will be null
    }

    return {
      rewardToken: contractData.rewardToken,
      rewardTokenSymbol,
      totalRewardsEmission: contractData.totalRewardsEmission,
      lastBlockHandled: contractData.highestBlockSeen,
      activityCount: activityIds.length,
      totalStake: totalStake.toString(),
      totalDistributed: totalDistributed.toString(),
      currentSeason
    };
  } catch (error) {
    console.error("Failed to fetch Rewards overview:", error);
    throw error;
  }
};

/**
 * User activities response with unclaimed and claimed rewards
 */
export interface UserActivitiesResponse {
  unclaimedRewards: string;
  claimedRewards: string;  // Total claimed rewards from RewardsClaimed events
  activities: UserActivity[];
}

/**
 * Get all activities with their states and user-specific data
 * @param accessToken - Access token for authentication
 * @param userAddress - User address to include user-specific data
 * @param forceRefresh - If true, bypasses cache and fetches fresh data from blockchain
 * @returns User activities response with unclaimed rewards
 */
export const fetchUserActivities = async (
  accessToken: string,
  userAddress: string,
  forceRefresh: boolean = false
): Promise<UserActivitiesResponse> => {
  const rewardsAddress = getRewardsAddress();

  try {
    // Fetch all activities
    const activitiesMap = await fetchActivities(accessToken, rewardsAddress, forceRefresh);
    const activities = Array.from(activitiesMap.values());

    if (activities.length === 0) {
      // Fetch unclaimed and claimed rewards even with no activities
      const [unclaimedRewards, claimedRewardsMap] = await Promise.all([
        fetchUnclaimedRewards(accessToken, rewardsAddress, userAddress, forceRefresh),
        fetchClaimedRewards(accessToken, rewardsAddress)
      ]);
      const claimedRewards = claimedRewardsMap.get(userAddress.toLowerCase()) || 0n;
      return {
        unclaimedRewards,
        claimedRewards: claimedRewards.toString(),
        activities: []
      };
    }

    const activityIds = activities.map((a: any) => a.activityId);

    // Batch fetch all data in parallel (including claimed rewards from cached source)
    const [activityStatesMap, userInfoMap, unclaimedRewards, claimedRewardsMap] = await Promise.all([
      fetchActivityStates(accessToken, rewardsAddress, forceRefresh),
      fetchUserInfo(accessToken, rewardsAddress, userAddress, activityIds, forceRefresh),
      fetchUnclaimedRewards(accessToken, rewardsAddress, userAddress, forceRefresh),
      fetchClaimedRewards(accessToken, rewardsAddress,)
    ]);

    // Build shared pricing context once (used for LP/share-token TVL conversions)
    const [priceMap, mTokenAddress, vaultShareTokenAddress] = await Promise.all([
      getCompletePriceMap(accessToken),
      getMTokenAddress(accessToken),
      getVaultShareTokenAddress(accessToken).catch(() => ""),
    ]);
    const { sToken } = getSafetyModuleConfig();
    const pricingCtx = {
      priceMap,
      mTokenAddress,
      sTokenAddress: sToken.address || null,
      vaultShareTokenAddress: vaultShareTokenAddress || null,
    };

    // Combine all data
    const userActivities = await Promise.all(activities.map(async (activity: any) => {
      const activityId = activity.activityId;
      const state = activityStatesMap.get(activityId);
      const userInfo = userInfoMap.get(activityId) || { stake: "0", userIndex: "0" };

      const baseActivity = {
        activityId,
        name: activity.name || "",
        activityType: parseActivityType(activity.activityType),
        emissionRate: activity.emissionRate || "0",
        accRewardPerStake: state?.accRewardPerStake || "0",
        lastUpdateTime: state?.lastUpdateTime || "0",
        totalStake: state?.totalStake || "0",
        sourceContract: activity.sourceContract || "",
      };

      const { stakeDenomination, stakeAssetAddress } = inferStakeSemantics(baseActivity);
      const stakeUsdInfo = inferStakeUsdInfo(pricingCtx, {
        ...baseActivity,
        stakeDenomination,
        stakeAssetAddress,
      }, userInfo.stake);

      const personalEmissionRate = calculatePersonalEmissionRate(
        userInfo.stake,
        baseActivity.totalStake,
        baseActivity.emissionRate
      );

      return {
        ...baseActivity,
        stakeDenomination,
        stakeAssetAddress,
        stakeUnitPriceUsd: stakeUsdInfo.stakeUnitPriceUsd,
        totalStakeUsd: stakeUsdInfo.totalStakeUsd,
        userStake: userInfo.stake,
        userStakeUsd: stakeUsdInfo.userStakeUsd ?? null,
        userIndex: userInfo.userIndex,
        personalEmissionRate
      };
    }));

    // Get claimed rewards for this user from the cached map (O(1) lookup)
    const claimedRewards = claimedRewardsMap.get(userAddress.toLowerCase()) || 0n;

    return {
      unclaimedRewards,
      claimedRewards: claimedRewards.toString(),
      activities: userActivities
    };
  } catch (error) {
    console.error("Failed to fetch user activities:", error);
    throw error;
  }
};

/**
 * Get all activities in the system (without user-specific data)
 * @param accessToken - Access token for authentication
 * @param forceRefresh - If true, bypasses cache and fetches fresh data from blockchain
 * @returns Array of system activities
 */
export const fetchAllActivities = async (
  accessToken: string,
  forceRefresh: boolean = false
): Promise<SystemActivity[]> => {
  const rewardsAddress = getRewardsAddress();

  try {
    // Fetch all activities and their states
    const [activitiesMap, activityStatesMap] = await Promise.all([
      fetchActivities(accessToken, rewardsAddress, forceRefresh),
      fetchActivityStates(accessToken, rewardsAddress, forceRefresh)
    ]);

    const activities = Array.from(activitiesMap.values());

    if (activities.length === 0) {
      return [];
    }

    // Build shared pricing context once (used for LP/share-token TVL conversions)
    const [priceMap, mTokenAddress, vaultShareTokenAddress] = await Promise.all([
      getCompletePriceMap(accessToken),
      getMTokenAddress(accessToken),
      getVaultShareTokenAddress(accessToken).catch(() => ""),
    ]);
    const { sToken } = getSafetyModuleConfig();
    const pricingCtx = {
      priceMap,
      mTokenAddress,
      sTokenAddress: sToken.address || null,
      vaultShareTokenAddress: vaultShareTokenAddress || null,
    };

    // Combine activities with their states
    const enriched = await Promise.all(activities.map(async (activity: any) => {
      const activityId = activity.activityId;
      const state = activityStatesMap.get(activityId);

      const baseActivity = {
        activityId,
        name: activity.name || "",
        activityType: parseActivityType(activity.activityType),
        emissionRate: activity.emissionRate || "0",
        accRewardPerStake: state?.accRewardPerStake || "0",
        lastUpdateTime: state?.lastUpdateTime || "0",
        totalStake: state?.totalStake || "0",
        sourceContract: activity.sourceContract || "",
      };
      const { stakeDenomination, stakeAssetAddress } = inferStakeSemantics(baseActivity);
      const stakeUsdInfo = inferStakeUsdInfo(pricingCtx, {
        ...baseActivity,
        stakeDenomination,
        stakeAssetAddress,
      });

      return {
        ...baseActivity,
        stakeDenomination,
        stakeAssetAddress,
        stakeUnitPriceUsd: stakeUsdInfo.stakeUnitPriceUsd,
        totalStakeUsd: stakeUsdInfo.totalStakeUsd,
      };
    }));

    return enriched;
  } catch (error) {
    console.error("Failed to fetch all activities:", error);
    throw error;
  }
};

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  rank: number;
  address: string;
  totalRewardsEarned: string;
}

/**
 * Leaderboard response with pagination info
 */
export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total: number;
  offset: number;
  limit: number;
}

export const fetchLeaderboard = async (
  accessToken: string,
  forceRefresh: boolean = false,
  limit: number = 10,
  offset: number = 0
): Promise<LeaderboardResponse> => {
  const rewardsAddress = getRewardsAddress();

  try {
    const users = await fetchAllUsersLeaderboard(accessToken, rewardsAddress, forceRefresh);

    // Sort users by total rewards earned (unclaimed + pending)
    const sorted = users.sort((a, b) => {
      return compareBigInt(BigInt(a.totalRewardsEarned), BigInt(b.totalRewardsEarned));
    });

    const total = sorted.length;
    const paginated = sorted.slice(offset, offset + limit);

    // Assign ranks and map entries
    const entries = paginated.map((entry, index) => ({
      rank: offset + index + 1,
      ...entry,
    }));

    return { entries, total, offset, limit };
  } catch (error) {
    console.error("Failed to fetch leaderboard:", error);
    throw error;
  }
};


