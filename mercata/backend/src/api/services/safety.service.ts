import { strato, cirrus, bloc } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants, rewardsChef } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";
import { getTokenBalanceForUser } from "./tokens.service";
import { getStakedBalance, getPools, findPoolByLpToken } from "./rewardsChef.service";
import { waitForBalanceUpdate } from "../helpers/rewards/rewardsChef.helpers";

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
const getSafetyModuleConfig = (): SafetyModuleConfig => {
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

export const getSafetyModuleInfo = async (
  accessToken: string,
  userAddress: string
): Promise<SafetyModuleInfo> => {
  const safetyModuleConfig = getSafetyModuleConfig();
  const safetyModuleAddress = safetyModuleConfig.safetyModule.address;
  const sTokenAddress = safetyModuleConfig.sToken.address;

  try {
    // Note: We need to query multiple sources for complete SafetyModule data:
    // 1. SafetyModule contract config (COOLDOWN_SECONDS, UNSTAKE_WINDOW, etc.)
    // 2. USDST balance of SafetyModule contract (this is totalAssets)
    // 3. sToken totalSupply (this is totalShares)
    // 4. User's sToken balance
    // 5. User's cooldown start time
    
    let safetyModuleData: any[] = [];
    let usdstContractBalance: any[] = [];
    let sTokenTotalSupply: any[] = [];
    let userTokenBalance: any[] = [];
    let cooldownData: any[] = [];

    try {
      // Query SafetyModule contract configuration
      const response1 = await cirrus.get(
        accessToken,
        `/BlockApps-Mercata-SafetyModule`,
        {
          params: {
            address: `eq.${safetyModuleAddress}`,
            select: "*"
          }
        }
      );
      safetyModuleData = response1.data || [];
    } catch (error) {
      console.warn("SafetyModule contract not found or not deployed:", error);
    }

    try {
      // Query USDST balance of SafetyModule contract (this represents totalAssets)
      // Use the nested relationship pattern like other services
      const response2 = await cirrus.get(
        accessToken,
        `/BlockApps-Mercata-Token`,
        {
          params: {
            address: `eq.${safetyModuleConfig.asset.address}`,
            select: `address,balances:BlockApps-Mercata-Token-_balances(user:key,balance:value::text)`,
            "balances.key": `eq.${safetyModuleAddress}`
          }
        }
      );
      const tokenData = response2.data || [];
      usdstContractBalance = tokenData?.[0]?.balances || [];
    } catch (error) {
      console.warn("USDST balance of SafetyModule query failed:", error);
    }

    try {
      // Query sToken total supply (this represents totalShares)
      const response3 = await cirrus.get(
        accessToken,
        `/BlockApps-Mercata-Token`,
        {
          params: {
            address: `eq.${sTokenAddress}`,
            select: "_totalSupply::text"
          }
        }
      );
      sTokenTotalSupply = response3.data || [];
    } catch (error) {
      console.warn("sToken total supply query failed:", error);
    }

    try {
      // Query user's sUSDST token balance using nested relationship pattern
      const response4 = await cirrus.get(
        accessToken,
        `/BlockApps-Mercata-Token`,
        {
          params: {
            address: `eq.${sTokenAddress}`,
            select: `address,balances:BlockApps-Mercata-Token-_balances(user:key,balance:value::text)`,
            "balances.key": `eq.${userAddress.toLowerCase()}`
          }
        }
      );
      const tokenData = response4.data || [];
      userTokenBalance = tokenData?.[0]?.balances || [];
    } catch (error) {
      console.warn("sUSDST token balance query failed:", error);
    }

    try {
      // Query user's cooldown start from SafetyModule
      const response5 = await cirrus.get(
        accessToken,
        `/BlockApps-Mercata-SafetyModule-cooldownStart`,
        {
          params: {
            key: `eq.${userAddress.toLowerCase()}`,
            select: "value::text"
          }
        }
      );
      cooldownData = response5.data || [];
    } catch (error) {
      console.warn("SafetyModule cooldown data query failed:", error);
    }

    // Extract data from responses
    const safetyModule = safetyModuleData?.[0] || {};
    
    // Get totalAssets from SafetyModule's USDST balance (nested structure)
    const totalAssets = usdstContractBalance?.[0]?.balance || "0";
    
    // Get totalShares from sToken's total supply
    const totalShares = sTokenTotalSupply?.[0]?._totalSupply || "0";
    
    // Get config values from SafetyModule contract
    const cooldownSeconds = safetyModule.COOLDOWN_SECONDS?.toString() || "259200"; // 3 days default
    const unstakeWindow = safetyModule.UNSTAKE_WINDOW?.toString() || "172800"; // 2 days default
    
    // Get user-specific data (nested structure)
    const userShares = userTokenBalance?.[0]?.balance || "0";
    const cooldownStart = cooldownData?.[0]?.value || "0";

    // Get user's staked sUSDST balance from RewardsChef
    // Find the pool for this sToken
    const poolForSToken = await findPoolByLpToken(accessToken, rewardsChef, sTokenAddress);

    // If no pool found, staked balance is 0
    const stakedSTokenBalance = poolForSToken
      ? await getStakedBalance(accessToken, rewardsChef, poolForSToken.poolIdx, userAddress)
      : "0";

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
  const sTokenAddress = safetyModuleConfig.sToken.address;

  // Get user's sUSDST balance before stake
  const sTokenBalanceBefore = stakeSToken ? await getTokenBalanceForUser(accessToken, sTokenAddress, userAddress) : "0";

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

  // If staking is requested and stake was successful, execute staking transaction
  if (stakeSToken && stakeResult.status === "Success") {
    // Wait for Cirrus to index the new sUSDST balance with retry logic
    const sTokenBalanceAfter = await waitForBalanceUpdate(
      accessToken,
      sTokenAddress,
      userAddress,
      sTokenBalanceBefore,
      10,  // max retries
      200  // 200ms delay between retries
    );

    const newlyMintedAmount = (BigInt(sTokenBalanceAfter) - BigInt(sTokenBalanceBefore)).toString();

    if (BigInt(newlyMintedAmount) > 0n) {
      // Find the pool for this sToken
      const poolForSToken = await findPoolByLpToken(accessToken, rewardsChef, sTokenAddress);

      if (!poolForSToken) {
        throw new Error(`No RewardsChef pool found for sToken ${sTokenAddress}. Cannot stake after deposit.`);
      }

      const poolIdx = poolForSToken.poolIdx;

      const stakingTx: FunctionInput[] = [
        // First approve sUSDST for RewardsChef
        {
          contractName: extractContractName(Token),
          contractAddress: sTokenAddress,
          method: "approve",
          args: { spender: rewardsChef, value: newlyMintedAmount },
        },
        // Then deposit into RewardsChef
        {
          contractName: "RewardsChef",
          contractAddress: rewardsChef,
          method: "deposit",
          args: { _pid: poolIdx, _amount: newlyMintedAmount },
        },
      ];

      const builtStakingTx = await buildFunctionTx(stakingTx, userAddress, accessToken);
      const stakingResult = await postAndWaitForTx(accessToken, () =>
        bloc.post(accessToken, StratoPaths.transactionParallel, builtStakingTx)
      );

      // Fail the entire operation if staking fails
      if (stakingResult.status !== "Success") {
        throw new Error("Stake to SafetyModule succeeded but staking to rewards program failed");
      }
    }
  }

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
  const sTokenAddress = safetyModuleConfig.sToken.address;

  // If includeStakedSToken is enabled, we might need to unstake first
  if (includeStakedSToken) {
    // Get current sUSDST balance in wallet
    const unstakedSTokenBalance = await getTokenBalanceForUser(accessToken, sTokenAddress, userAddress);

    // Calculate required sTokens for redemption
    const requiredSTokenWei = BigInt(sharesAmount);

    // Check if we need to unstake
    const unstakedSTokenWei = BigInt(unstakedSTokenBalance);

    if (requiredSTokenWei > unstakedSTokenWei) {
      // We need to unstake some sTokens first
      const amountToUnstake = requiredSTokenWei - unstakedSTokenWei;

      // Find the pool for this sToken
      const poolForSToken = await findPoolByLpToken(accessToken, rewardsChef, sTokenAddress);

      if (!poolForSToken) {
        throw new Error(`No RewardsChef pool found for sToken ${sTokenAddress}. Cannot unstake before redemption.`);
      }

      const poolIdx = poolForSToken.poolIdx;

      // Build unstaking transaction
      const unstakeTx = await buildFunctionTx({
        contractName: "RewardsChef",
        contractAddress: rewardsChef,
        method: "withdraw",
        args: {
          _pid: poolIdx,
          _amount: amountToUnstake.toString()
        }
      }, userAddress, accessToken);

      // Execute unstaking transaction first
      await postAndWaitForTx(accessToken, () =>
        strato.post(accessToken, StratoPaths.transactionParallel, unstakeTx)
      );
    }
  }

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
