import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import * as config from "../../config/config";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";
import { getTokenBalanceForUser } from "./tokens.service";
// RewardsChef disabled:
// import { getPools } from "./rewardsChef.service";
// import { waitForBalanceUpdate, getStakedBalance, findPoolByLpToken } from "../helpers/rewards/rewardsChef.helpers";

const SafetyModule = "mercata/backend/src/api/contracts/concrete/Lending/SafetyModule.sol";
const { Token } = constants;

interface SafetyModuleInfo {
  totalAssets: string;
  totalShares: string;
  userShares: string;
  userSharesStaked: string;
  userSharesTotal: string;
  userCooldownStart: string;
  cooldownSeconds: string;
  unstakeWindow: string;
  exchangeRate: string;
  canRedeem: boolean;
  cooldownActive: boolean;
  cooldownTimeRemaining: string;
  unstakeWindowTimeRemaining: string;
  maxRedeemable: string;
  maxRedeemableTotal: string;
  redeemValue: string;
  redeemValueTotal: string;
}

interface SafetyModuleConfig {
  safetyModule: {
    address: string;
  };
  asset: {
    address: string;
  };
  sToken: {
    address: string;
  };
}

// Get SafetyModule contract info from constants
export const getSafetyModuleConfig = (): SafetyModuleConfig => {
  // For now, using placeholder addresses - these should be configured via environment variables
  // similar to how lendingRegistry, poolFactory, etc. are configured
  return {
    safetyModule: {
      address: process.env.SAFETY_MODULE || "0000000000000000000000000000000000001015"
    },
    asset: {
      address: process.env.USDST_ADDRESS || "937efa7e3a77e20bbdbd7c0d32b6514f368c1010"
    },
    sToken: {
      address: process.env.SUSDST_ADDRESS || "0000000000000000000000000000000000001016"
    }
  };
};

export const getPublicSafetyModuleInfo = async (
  accessToken: string
): Promise<SafetyModuleInfo> => {
  // NOTE: This function does NOT fetch any user-specific data.
  // It only queries public contract data (SafetyModule config and sToken total supply).
  // All user-specific fields are returned as "0" or false.
  
  const safetyModuleConfig = getSafetyModuleConfig();
  const safetyModuleAddress = safetyModuleConfig.safetyModule.address;
  const sTokenAddress = safetyModuleConfig.sToken.address;

  try {
    let safetyModuleData: any[] = [];
    let sTokenTotalSupply: any[] = [];

    try {
      // Query SafetyModule contract configuration and _managedAssets (public data only)
      // No user-specific queries - no balances, no cooldown data, no staked balances
      const response1 = await cirrus.get(
        accessToken,
        `/BlockApps-SafetyModule`,
        {
          params: {
            address: `eq.${safetyModuleAddress}`,
            select: "*,_managedAssets::text"
          }
        }
      );
      safetyModuleData = response1.data || [];
    } catch (error) {
      console.warn("SafetyModule contract not found or not deployed:", error);
    }

    try {
      // Query sToken total supply (public data only - no user balances)
      const response2 = await cirrus.get(
        accessToken,
        `/BlockApps-Token`,
        {
          params: {
            address: `eq.${sTokenAddress}`,
            select: "_totalSupply::text"
            // NOTE: No balances query - we don't fetch user-specific token balances
          }
        }
      );
      sTokenTotalSupply = response2.data || [];
    } catch (error) {
      console.warn("sToken total supply query failed:", error);
    }

    // Extract data from responses
    const safetyModule = safetyModuleData?.[0] || {};
    
    // Get totalAssets from SafetyModule's _managedAssets state variable (public data)
    const totalAssets = safetyModule._managedAssets || "0";
    
    // Get totalShares from sToken's total supply (public data)
    const totalShares = sTokenTotalSupply?.[0]?._totalSupply || "0";
    
    // Get config values from SafetyModule contract (public data)
    const cooldownSeconds = safetyModule.COOLDOWN_SECONDS?.toString() || "259200"; // 3 days default
    const unstakeWindow = safetyModule.UNSTAKE_WINDOW?.toString() || "172800"; // 2 days default

    // Calculate exchange rate (assets per share) - public calculation
    const exchangeRate = totalShares !== "0" && BigInt(totalShares) > 0n 
      ? (BigInt(totalAssets) * BigInt("1000000000000000000")) / BigInt(totalShares) // 18 decimals
      : BigInt("1000000000000000000"); // 1:1 ratio initially

    // Return public data only - no user-specific fields included
    return {
      totalAssets,
      totalShares,
      cooldownSeconds,
      unstakeWindow,
      exchangeRate: exchangeRate.toString(),
    } as SafetyModuleInfo;
  } catch (error) {
    console.error("Error fetching public SafetyModule info:", error);
    // Return default public values in case of error - no user-specific fields
    return {
      totalAssets: "0",
      totalShares: "0",
      cooldownSeconds: "259200",
      unstakeWindow: "172800",
      exchangeRate: "1000000000000000000",
    } as SafetyModuleInfo;
  }
};

export const getSafetyModuleInfo = async (
  accessToken: string,
  userAddress: string
): Promise<SafetyModuleInfo> => {
  const safetyModuleConfig = getSafetyModuleConfig();
  const safetyModuleAddress = safetyModuleConfig.safetyModule.address;
  const sTokenAddress = safetyModuleConfig.sToken.address;

  try {
    // Note: We need to query multiple sources for complete SafetyModule data:
    // 1. SafetyModule contract config and _managedAssets (COOLDOWN_SECONDS, UNSTAKE_WINDOW, _managedAssets, etc.)
    // 2. sToken totalSupply (this is totalShares)
    // 3. User's sToken balance
    // 4. User's cooldown start time
    
    let safetyModuleData: any[] = [];
    let sTokenTotalSupply: any[] = [];
    let userTokenBalance: any[] = [];
    let cooldownData: any[] = [];

    try {
      // Query SafetyModule contract configuration and _managedAssets
      const response1 = await cirrus.get(
        accessToken,
        `/BlockApps-SafetyModule`,
        {
          params: {
            address: `eq.${safetyModuleAddress}`,
            select: "*,_managedAssets::text"
          }
        }
      );
      safetyModuleData = response1.data || [];
    } catch (error) {
      console.warn("SafetyModule contract not found or not deployed:", error);
    }

    try {
      // Query sToken total supply (this represents totalShares)
      const response2 = await cirrus.get(
        accessToken,
        `/BlockApps-Token`,
        {
          params: {
            address: `eq.${sTokenAddress}`,
            select: "_totalSupply::text"
          }
        }
      );
      sTokenTotalSupply = response2.data || [];
    } catch (error) {
      console.warn("sToken total supply query failed:", error);
    }

    try {
      // Query user's sUSDST token balance using nested relationship pattern
      const response3 = await cirrus.get(
        accessToken,
        `/BlockApps-Token`,
        {
          params: {
            address: `eq.${sTokenAddress}`,
            select: `address,balances:BlockApps-Token-_balances(user:key,balance:value::text)`,
            "balances.key": `eq.${userAddress.toLowerCase()}`
          }
        }
      );
      const tokenData = response3.data || [];
      userTokenBalance = tokenData?.[0]?.balances || [];
    } catch (error) {
      console.warn("sUSDST token balance query failed:", error);
    }

    try {
      // Query user's cooldown start from SafetyModule
      const response4 = await cirrus.get(
        accessToken,
        `/BlockApps-SafetyModule-cooldownStart`,
        {
          params: {
            key: `eq.${userAddress.toLowerCase()}`,
            select: "value::text"
          }
        }
      );
      cooldownData = response4.data || [];
    } catch (error) {
      console.warn("SafetyModule cooldown data query failed:", error);
    }

    // Extract data from responses
    const safetyModule = safetyModuleData?.[0] || {};
    
    // Get totalAssets from SafetyModule's _managedAssets state variable
    const totalAssets = safetyModule._managedAssets || "0";
    
    // Get totalShares from sToken's total supply
    const totalShares = sTokenTotalSupply?.[0]?._totalSupply || "0";
    
    // Get config values from SafetyModule contract
    const cooldownSeconds = safetyModule.COOLDOWN_SECONDS?.toString() || "259200"; // 3 days default
    const unstakeWindow = safetyModule.UNSTAKE_WINDOW?.toString() || "172800"; // 2 days default
    
    // Get user-specific data (nested structure)
    const userShares = userTokenBalance?.[0]?.balance || "0";
    const cooldownStart = cooldownData?.[0]?.value || "0";

    // RewardsChef disabled:
    // const poolForSToken = await findPoolByLpToken(accessToken, config.rewardsChef, sTokenAddress);
    // const stakedSTokenBalance = poolForSToken
    //   ? await getStakedBalance(accessToken, config.rewardsChef, poolForSToken.poolIdx, userAddress)
    //   : "0";
    const stakedSTokenBalance = "0";

    // Calculate exchange rate (assets per share)
    const exchangeRate = totalShares !== "0" && BigInt(totalShares) > 0n 
      ? (BigInt(totalAssets) * BigInt("1000000000000000000")) / BigInt(totalShares) // 18 decimals
      : BigInt("1000000000000000000"); // 1:1 ratio initially

    // Calculate cooldown status
    const currentTime = Math.floor(Date.now() / 1000);
    const cooldownStartTime = parseInt(cooldownStart);
    const cooldownDuration = parseInt(cooldownSeconds);
    const unstakeWindowDuration = parseInt(unstakeWindow);

    const cooldownActive = cooldownStartTime > 0;
    const cooldownEndTime = cooldownStartTime + cooldownDuration;
    const unstakeWindowEndTime = cooldownEndTime + unstakeWindowDuration;

    const canRedeem = cooldownActive && currentTime >= cooldownEndTime && currentTime <= unstakeWindowEndTime;

    const cooldownTimeRemaining = cooldownActive && currentTime < cooldownEndTime
      ? (cooldownEndTime - currentTime).toString()
      : "0";

    const unstakeWindowTimeRemaining = cooldownActive && currentTime >= cooldownEndTime && currentTime <= unstakeWindowEndTime
      ? (unstakeWindowEndTime - currentTime).toString()
      : "0";

    // Calculate max redeemable amounts (min of user shares value and available assets)
    // For unstaked shares only
    const userSharesBigInt = BigInt(userShares);
    const userAssetsValue = userSharesBigInt > 0n
      ? ((userSharesBigInt * BigInt(exchangeRate)) / (10n ** 18n))
      : 0n;

    const availableAssets = BigInt(totalAssets);
    const maxRedeemable = userAssetsValue < availableAssets
      ? userAssetsValue.toString()
      : availableAssets.toString();

    // For total shares (unstaked + staked)
    const userSharesTotal = BigInt(userShares) + BigInt(stakedSTokenBalance);
    const userAssetsTotalValue = userSharesTotal > 0n
      ? ((userSharesTotal * BigInt(exchangeRate)) / (10n ** 18n))
      : 0n;

    const maxRedeemableTotal = userAssetsTotalValue < availableAssets
      ? userAssetsTotalValue.toString()
      : availableAssets.toString();

    return {
      totalAssets,
      totalShares,
      userShares, // This is the unstaked (wallet) balance
      userSharesStaked: stakedSTokenBalance, // Staked balance from RewardsChef
      userSharesTotal: userSharesTotal.toString(), // Total = wallet + staked
      userCooldownStart: cooldownStart,
      cooldownSeconds,
      unstakeWindow,
      exchangeRate: exchangeRate.toString(),
      canRedeem,
      cooldownActive,
      cooldownTimeRemaining,
      unstakeWindowTimeRemaining,
      maxRedeemable, // Max assets redeemable with just unstaked shares
      maxRedeemableTotal, // Max assets redeemable with unstaked + staked shares
      redeemValue: userAssetsValue.toString(), // Value of unstaked shares in assets
      redeemValueTotal: userAssetsTotalValue.toString(), // Value of total shares in assets
    };
  } catch (error) {
    console.error("Error fetching SafetyModule info:", error);
    // Return default values in case of error
    return {
      totalAssets: "0",
      totalShares: "0",
      userShares: "0",
      userSharesStaked: "0",
      userSharesTotal: "0",
      userCooldownStart: "0",
      cooldownSeconds: "259200",
      unstakeWindow: "172800",
      exchangeRate: "1000000000000000000",
      canRedeem: false,
      cooldownActive: false,
      cooldownTimeRemaining: "0",
      unstakeWindowTimeRemaining: "0",
      maxRedeemable: "0",
      maxRedeemableTotal: "0",
      redeemValue: "0",
      redeemValueTotal: "0",
    };
  }
};

export const stakeSafetyModule = async (
  accessToken: string,
  userAddress: string,
  { amount, stakeSToken }: { amount: string; stakeSToken: boolean }
): Promise<{ status: string; hash: string }> => {
  const safetyModuleConfig = getSafetyModuleConfig();
  // RewardsChef disabled:
  // const sTokenAddress = safetyModuleConfig.sToken.address;
  // const sTokenBalanceBefore = stakeSToken ? await getTokenBalanceForUser(accessToken, sTokenAddress, userAddress) : "0";

  // Calculate minimum shares out (with 1% slippage tolerance)
  const info = await getSafetyModuleInfo(accessToken, userAddress);
  const amountBigInt = BigInt(amount);
  const exchangeRate = BigInt(info.exchangeRate);
  const expectedShares = (amountBigInt * BigInt("1000000000000000000")) / exchangeRate;
  const minSharesOut = (expectedShares * BigInt(99)) / BigInt(100); // 1% slippage

  const tx: FunctionInput = {
    contractName: extractContractName(SafetyModule),
    contractAddress: safetyModuleConfig.safetyModule.address,
    method: "stake",
    args: {
      assetsIn: amount,
      minSharesOut: minSharesOut.toString()
    },
  };

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  const stakeResult = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );

  // RewardsChef disabled:
  // if (stakeSToken && stakeResult.status === "Success") {
  //   const sTokenBalanceAfter = await waitForBalanceUpdate(
  //     accessToken,
  //     sTokenAddress,
  //     userAddress,
  //     sTokenBalanceBefore,
  //     10,
  //     200
  //   );
  //   const newlyMintedAmount = (BigInt(sTokenBalanceAfter) - BigInt(sTokenBalanceBefore)).toString();
  //   if (BigInt(newlyMintedAmount) > 0n) {
  //     const poolForSToken = await findPoolByLpToken(accessToken, config.rewardsChef, sTokenAddress);
  //     if (!poolForSToken) {
  //       throw new Error(`No RewardsChef pool found for sToken ${sTokenAddress}. Cannot stake after deposit.`);
  //     }
  //     const poolIdx = poolForSToken.poolIdx;
  //     const stakingTx: FunctionInput[] = [
  //       {
  //         contractName: extractContractName(Token),
  //         contractAddress: sTokenAddress,
  //         method: "approve",
  //         args: { spender: config.rewardsChef, value: newlyMintedAmount },
  //       },
  //       {
  //         contractName: "RewardsChef",
  //         contractAddress: config.rewardsChef,
  //         method: "deposit",
  //         args: { _pid: poolIdx, _amount: newlyMintedAmount },
  //       },
  //     ];
  //     const builtStakingTx = await buildFunctionTx(stakingTx, userAddress, accessToken);
  //     const stakingResult = await postAndWaitForTx(accessToken, () =>
  //       bloc.post(accessToken, StratoPaths.transactionParallel, builtStakingTx)
  //     );
  //     if (stakingResult.status !== "Success") {
  //       throw new Error("Stake to SafetyModule succeeded but staking to rewards program failed");
  //     }
  //   }
  // }

  return stakeResult;
};

export const startCooldownSafetyModule = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  const safetyModuleConfig = getSafetyModuleConfig();

  const tx: FunctionInput = {
    contractName: extractContractName(SafetyModule),
    contractAddress: safetyModuleConfig.safetyModule.address,
    method: "startCooldown",
    args: {},
  };

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const redeemSafetyModule = async (
  accessToken: string,
  userAddress: string,
  { sharesAmount, includeStakedSToken = false }: { sharesAmount: string; includeStakedSToken?: boolean }
): Promise<{ status: string; hash: string }> => {
  const safetyModuleConfig = getSafetyModuleConfig();
  // const sTokenAddress = safetyModuleConfig.sToken.address;
  // RewardsChef disabled:
  // if (includeStakedSToken) {
  //   const unstakedSTokenBalance = await getTokenBalanceForUser(accessToken, sTokenAddress, userAddress);
  //   const requiredSTokenWei = BigInt(sharesAmount);
  //   const unstakedSTokenWei = BigInt(unstakedSTokenBalance);
  //   if (requiredSTokenWei > unstakedSTokenWei) {
  //     const amountToUnstake = requiredSTokenWei - unstakedSTokenWei;
  //     const poolForSToken = await findPoolByLpToken(accessToken, config.rewardsChef, sTokenAddress);
  //     if (!poolForSToken) {
  //       throw new Error(`No RewardsChef pool found for sToken ${sTokenAddress}. Cannot unstake before redemption.`);
  //     }
  //     const poolIdx = poolForSToken.poolIdx;
  //     const unstakeTx = await buildFunctionTx({
  //       contractName: "RewardsChef",
  //       contractAddress: config.rewardsChef,
  //       method: "withdraw",
  //       args: {
  //         _pid: poolIdx,
  //         _amount: amountToUnstake.toString()
  //       }
  //     }, userAddress, accessToken);
  //     await postAndWaitForTx(accessToken, () =>
  //       strato.post(accessToken, StratoPaths.transactionParallel, unstakeTx)
  //     );
  //   }
  // }

  // Calculate minimum assets out (with 1% slippage tolerance)
  const info = await getSafetyModuleInfo(accessToken, userAddress);
  const sharesBigInt = BigInt(sharesAmount);
  const exchangeRate = BigInt(info.exchangeRate);
  const expectedAssets = (sharesBigInt * exchangeRate) / BigInt("1000000000000000000");
  const minAssetsOut = (expectedAssets * BigInt(99)) / BigInt(100); // 1% slippage

  const tx: FunctionInput = {
    contractName: extractContractName(SafetyModule),
    contractAddress: safetyModuleConfig.safetyModule.address,
    method: "redeem",
    args: {
      sharesIn: sharesAmount,
      minAssetsOut: minAssetsOut.toString()
    },
  };

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const redeemAllSafetyModule = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  const info = await getSafetyModuleInfo(accessToken, userAddress);
  
  if (BigInt(info.userShares) === 0n) {
    throw new Error("No shares to redeem");
  }

  return await redeemSafetyModule(accessToken, userAddress, { 
    sharesAmount: info.userShares 
  });
};
