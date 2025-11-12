import { cirrus, strato, bloc } from "../../utils/mercataApiHelper";

import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx, until } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import * as config from "../../config/config";
import { getBalance, getTokens, getTokenBalanceForUser } from "./tokens.service";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";
import { getPools } from "./rewardsChef.service";
import { waitForBalanceUpdate, getStakedBalance, findPoolByLpToken } from "../helpers/rewards/rewardsChef.helpers";
import {
  simulateLoan,
  CollateralInfo,
  AssetConfig,
  calculateCollateralMetrics,
  calculateTotalCollateralValue,
  calculateTotalCollateralValueForHealth,
  calculateHealthFactor,
  calculateAPYs,
  toBig,
  debtFromScaled,
  totalDebtFromScaled,
  previewBorrowIndexFromFlatApr,
} from "../helpers/lending.helper";

const {
  registrySelectFields,
  lendingRegistry,
  LendingPool,
  LendingRegistry,
  Token,
  CollateralVault,
  PriceOracle,
  RewardsChef,
} = constants;

/**
 * Get the latest exchange rate for the lending pool from Cirrus events
 */
export const getExchangeRateFromCirrus = async (
  accessToken: string,
): Promise<string> => {
  const oneToOne = (10n ** 18n).toString();
  try {
    // Query the most recent ExchangeRateUpdated event from the lending pool
    const response = await cirrus.get(
      accessToken,
      `/${LendingPool}-ExchangeRateUpdated`,
      {
        params: {
          select: "newRate::text,block_timestamp",
          order: "block_timestamp.desc",
          limit: "1"
        }
      }
    );

    const events = response?.data || [];
    if (events.length === 0) {
      return oneToOne; // Default 1:1 exchange rate
    }

    const latestEvent = events[0];
    const exchangeRate = latestEvent?.newRate || oneToOne;

    return exchangeRate;
  } catch (error) {
    console.error(`Error fetching exchange rate from Cirrus for lending pool: `, error);
    return oneToOne;
  }
};


/**
 * Generic Cirrus fetch for the LendingRegistry row.
 * - No implicit user filters here. Callers pass explicit filters/selects when needed.
 */
export const getPool = async (
  accessToken: string,
  options: Record<string, string> = {}
): Promise<Record<string, any>> => {
  const { select, ...filters } = options;
  const cleanedFilters = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined)
  );

  const params = {
    ...cleanedFilters,
    select: select ?? registrySelectFields.join(","),
    address: `eq.${lendingRegistry}`,
  };

  const {
    data: [poolData],
  } = await cirrus.get(accessToken, `/${LendingRegistry}`, { params });

  if (!poolData) {
    throw new Error(
      `Error fetching ${extractContractName(LendingRegistry)} data from Cirrus`
    );
  }

  return poolData;
};

export const depositLiquidity = async (
  accessToken: string,
  userAddress: string,
  amount: string,
  stakeMToken: boolean,
) => {
  const { liquidityPool, lendingPool, borrowableAsset: { borrowableAsset }, mToken: { mToken } } = await getPool(
    accessToken,
    {
      select: `liquidityPool,lendingPool,borrowableAsset:lendingPool_fkey(borrowableAsset),mToken:lendingPool_fkey(mToken)`,
    } as Record<string, string>
  );

  if (!liquidityPool || !lendingPool || !borrowableAsset || (stakeMToken && !mToken)) {
    throw new Error("Liquidity pool, lending pool, borrowable asset or mToken address not found");
  }

  // Get user's mToken balance before deposit
  const mTokenBalanceBefore = stakeMToken ? await getTokenBalanceForUser(accessToken, mToken, userAddress) : "0";

  // First transaction: deposit liquidity
  const depositTx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: borrowableAsset,
      method: "approve",
      args: { spender: liquidityPool, value: amount },
    },
    {
      contractName: extractContractName(LendingPool),
      contractAddress: lendingPool,
      method: "depositLiquidity",
      args: { amount },
    },
  ];

  const builtDepositTx = await buildFunctionTx(depositTx, userAddress, accessToken);
  const depositResult = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtDepositTx)
  );

  // If staking is requested and deposit was successful, execute staking transaction
  if (stakeMToken && depositResult.status === "Success") {
    // Wait for Cirrus to index the new mToken balance with retry logic
    const mTokenBalanceAfter = await waitForBalanceUpdate(
      accessToken,
      mToken,
      userAddress,
      mTokenBalanceBefore,
      10,  // max retries
      200  // 200ms delay between retries
    );

    const newlyMintedAmount = (BigInt(mTokenBalanceAfter) - BigInt(mTokenBalanceBefore)).toString();

    if (BigInt(newlyMintedAmount) > 0n) {
      // Find the pool for this mToken
      const rewardsPool = await findPoolByLpToken(accessToken, config.rewardsChef, mToken);

      if (!rewardsPool) {
        throw new Error(`No RewardsChef pool found for mToken ${mToken}. Cannot stake after deposit.`);
      }

      const stakingTx: FunctionInput[] = [
        // First approve mToken for RewardsChef
        {
          contractName: extractContractName(Token),
          contractAddress: mToken,
          method: "approve",
          args: { spender: config.rewardsChef, value: newlyMintedAmount },
        },
        // Then deposit into RewardsChef
        {
          contractName: extractContractName(RewardsChef),
          contractAddress: config.rewardsChef,
          method: "deposit",
          args: { _pid: rewardsPool.poolIdx, _amount: newlyMintedAmount },
        },
      ];

      const builtStakingTx = await buildFunctionTx(stakingTx, userAddress, accessToken);
      const stakingResult = await postAndWaitForTx(accessToken, () =>
        bloc.post(accessToken, StratoPaths.transactionParallel, builtStakingTx)
      );

      // Fail the entire operation if staking fails
      if (stakingResult.status !== "Success") {
        throw new Error("Deposit succeeded but staking failed");
      }
    }
  }

  return depositResult;
};

export const withdrawLiquidity = async (
  accessToken: string,
  userAddress: string,
  amount: string,
  includeStakedMToken: boolean = false
) => {
  const { lendingPool } = await getPool(accessToken, { select: "lendingPool" });
  if (!lendingPool) {
    throw new Error("Lending pool address not found");
  }

  // If includeStakedMToken is enabled, we might need to unstake first
  if (includeStakedMToken) {
    // Get mToken address first
    const { mToken: { mToken } } = await getPool(accessToken, {
      select: "mToken:lendingPool_fkey(mToken)"
    });
    if (!mToken) {
      throw new Error("mToken address not found");
    }

    // Get current mUSDST balance in wallet
    const unstakedMTokenBalance = await getTokenBalanceForUser(accessToken, mToken, userAddress);

    // Get exchange rate to convert withdrawal amount (USDST) to required mTokens
    const exchangeRateResponse = await getExchangeRateFromCirrus(accessToken);
    const exchangeRate = exchangeRateResponse || "1000000000000000000"; // Default 1:1 if not available

    // Convert withdrawal amount (USDST) to required mTokens
    // Use ceiling division to ensure we unstake enough mTokens to cover the withdrawal
    const amountWei = BigInt(amount);
    const exchangeRateWei = BigInt(exchangeRate);
    const numerator = amountWei * (10n ** 18n);
    const requiredMTokenWei = (numerator + exchangeRateWei - 1n) / exchangeRateWei; // Ceiling division

    // Check if we need to unstake
    const unstakedMTokenWei = BigInt(unstakedMTokenBalance);

    if (requiredMTokenWei > unstakedMTokenWei) {
      // We need to unstake some mTokens first
      const amountToUnstake = requiredMTokenWei - unstakedMTokenWei;

      // Find the pool for this mToken
      const rewardsPool = await findPoolByLpToken(accessToken, config.rewardsChef, mToken);

      if (!rewardsPool) {
        throw new Error(`No RewardsChef pool found for mToken ${mToken}. Cannot unstake before withdrawal.`);
      }

      // Build unstaking transaction
      const unstakeTx = await buildFunctionTx({
        contractName: extractContractName(RewardsChef),
        contractAddress: config.rewardsChef,
        method: "withdraw",
        args: {
          _pid: rewardsPool.poolIdx,
          _amount: amountToUnstake.toString()
        }
      }, userAddress, accessToken);

      // Execute unstaking transaction first
      await postAndWaitForTx(accessToken, () =>
        strato.post(accessToken, StratoPaths.transactionParallel, unstakeTx)
      );
    }
  }

  // Now proceed with the normal withdrawal
  const builtTx = await buildFunctionTx({
    contractName: extractContractName(LendingPool),
    contractAddress: lendingPool,
    method: "withdrawLiquidity",
    args: { amount },
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const withdrawLiquidityAll = async (
  accessToken: string,
  userAddress: string,
) => {
  const { lendingPool } = await getPool(accessToken, { select: "lendingPool" });
  if (!lendingPool) {
    throw new Error("Lending pool address not found");
  }
  const builtTx = await buildFunctionTx({
    contractName: extractContractName(LendingPool),
    contractAddress: lendingPool,
    method: "withdrawLiquidityAll",
    args: {},
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const supplyCollateral = async (
  accessToken: string,
  userAddress: string,
  asset: string,
  amount: string,
) => {
  const { lendingPool, collateralVault } = await getPool(accessToken, { select: "lendingPool,collateralVault" });
  if (!lendingPool || !collateralVault) {
    throw new Error("Lending pool or collateral vault address not found");
  }

  const tx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: asset,
      method: "approve",
      args: { spender: collateralVault, value: amount },
    },
    {
      contractName: extractContractName(LendingPool),
      contractAddress: lendingPool,
      method: "supplyCollateral",
      args: { asset, amount },
    },
  ];

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const withdrawCollateral = async (
  accessToken: string,
  userAddress: string,
  asset: string,
  amount: string,
) => {
  const { lendingPool } = await getPool(accessToken, { select: "lendingPool" });
  if (!lendingPool) {
    throw new Error("Lending pool address not found");
  }

  const builtTx = await buildFunctionTx({
    contractName: extractContractName(LendingPool),
    contractAddress: lendingPool,
    method: "withdrawCollateral",
    args: { asset, amount },
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const borrow = async (
  accessToken: string,
  userAddress: string,
  amount: string,
) => {
  const { lendingPool } = await getPool(accessToken, { select: "lendingPool" });

  if (!lendingPool) {
    throw new Error("Lending pool address not found");
  }

  const builtTx = await buildFunctionTx({
    contractName: extractContractName(LendingPool),
    contractAddress: lendingPool,
    method: "borrow",
    args: { amount },
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const borrowMax = async (
  accessToken: string,
  userAddress: string,
) => {
  const { lendingPool } = await getPool(accessToken, { select: "lendingPool" });
  if (!lendingPool) {
    throw new Error("Lending pool address not found");
  }
  const builtTx = await buildFunctionTx({
    contractName: extractContractName(LendingPool),
    contractAddress: lendingPool,
    method: "borrowMax",
    args: {},
  }, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const repay = async (
  accessToken: string,
  userAddress: string,
  amount: string,
) => {
  const { liquidityPool, lendingPool, borrowableAsset: { borrowableAsset } } = await getPool(
    accessToken,
    {
      select: `liquidityPool,lendingPool,borrowableAsset:lendingPool_fkey(borrowableAsset)`,
    }
  );

  if (!liquidityPool || !lendingPool || !borrowableAsset) {
    throw new Error("Liquidity pool, lending pool or borrowable asset address not found");
  }

  const tx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: borrowableAsset,
      method: "approve",
      args: { spender: liquidityPool, value: amount },
    },
    {
      contractName: extractContractName(LendingPool),
      contractAddress: lendingPool,
      method: "repay",
      args: { amount },
    },
  ];

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  const result = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
  return { ...result, amountSent: amount };
};

export const collateralAndBalance = async (
  accessToken: string,
  userAddress: string,
) => {
  const registry = await getPool(accessToken, {
    select:
      `lendingPool:lendingPool_fkey(` +
        `assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value),` +
        `borrowableAsset,_paused` +
      `),` +
      `collateralVault:collateralVault_fkey(` +
        `userCollaterals:${CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text)` +
      `),` +
      `oracle:priceOracle_fkey(` +
        `prices:${PriceOracle}-prices(asset:key,price:value::text)` +
      `)`
  });

  if (!registry.lendingPool || !registry.collateralVault) {
    throw new Error("Lending pool or collateral vault not found");
  }

  const isPaused = registry.lendingPool._paused;

  const assets = registry.lendingPool.assetConfigs?.map((a: any) => a.asset).filter((asset: string) => asset !== registry.lendingPool.borrowableAsset) || [];
  const userCollaterals = (registry.collateralVault.userCollaterals || []).filter((c: any) => c.user === userAddress);
  const userTokens = await getBalance(accessToken, userAddress, {
    address: `in.(${assets.join(",")})`, select: `address,user:key,balance:value::text,token:${Token}(_name,_symbol,_owner,_totalSupply::text,customDecimals,images:${Token}-images(value))`
  });

  const tokenMap = new Map(userTokens.map((t: any) => [t.address, t]));
  const collateralMap = new Map(userCollaterals.map((c: any) => [c.asset, c]));

  // Create maps for asset configs and prices
  const assetConfigMap = new Map();
  const priceMap = new Map();

  // Build asset config map
  (registry.lendingPool?.assetConfigs || []).forEach((config: any) => {
    assetConfigMap.set(config.asset, config.AssetConfig);
  });

  // Build price map
  (registry.oracle?.prices || []).forEach((price: any) => {
    priceMap.set(price.asset, price.price);
  });

  return assets
    .filter((asset: string) => {
      const token = tokenMap.get(asset) as any;
      return token;
    })
    .map((asset: string) => {
      const token = tokenMap.get(asset) as any;
      const collateral = collateralMap.get(asset) as any;
      const assetConfig = assetConfigMap.get(asset);
      const assetPrice = priceMap.get(asset) || "0";

      const userBalance = token?.balance?.toString() || "0";
      const collateralizedAmount = collateral?.amount || "0";
      const ltv = assetConfig?.ltv || 0;
      const liquidationThreshold = assetConfig?.liquidationThreshold || 0;

      // Calculate metrics using the helper function
      const {userBalanceValue, collateralizedAmountValue, maxBorrowingPower} = calculateCollateralMetrics(
        userBalance,
        collateralizedAmount,
        assetPrice,
        ltv
      );

      return {
        address: asset,
        ...token?.token,
        userBalance,
        userBalanceValue,
        collateralizedAmount,
        collateralizedAmountValue,
        isCollateralized: collateral?.amount > 0,
        canSupply: BigInt(userBalance) > 0n,
        maxBorrowingPower,
        assetPrice,
        ltv,
        liquidationThreshold,
        isPaused,
      };
    });
};

export const liquidityAndBalance = async (
  accessToken: string,
  userAddress: string,
) => {
  // Fetch pool data with explicit select (index fields + userLoan + prices + pause status)
  const registry = await getPool(accessToken, {
    select:
      `lendingPool:lendingPool_fkey(` +
        `address,borrowableAsset,mToken,_paused,` +
        `borrowIndex::text,totalScaledDebt::text,reservesAccrued::text,lastAccrual::text,badDebt::text,` +
        `assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value),` +
        `userLoan:${LendingPool}-userLoan(user:key,LoanInfo:value)` +
      `),` +
      `collateralVault:collateralVault_fkey(` +
        `userCollaterals:${CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text)` +
      `),` +
      `oracle:priceOracle_fkey(address,` +
        `prices:${PriceOracle}-prices(asset:key,price:value::text)` +
      `),` +
      `liquidityPool:liquidityPool_fkey(address)`
  ,
    "lendingPool.userLoan.key": `eq.${userAddress}`
  });

  const { borrowableAsset, mToken, assetConfigs, _paused } = registry.lendingPool || {};
  const allCollaterals = registry.collateralVault?.userCollaterals || [];
  const isPaused = _paused;

  if (!borrowableAsset || !mToken) {
    throw new Error("Lending pool, borrowable asset, or mToken not found");
  }

  // Fetch token metadata with balances included
  const tokenData = await getTokens(accessToken, {
    address: `in.(${borrowableAsset},${mToken})`,
    select: `address,_name,_symbol,_owner,_totalSupply::text,customDecimals,balances:${Token}-_balances(user:key,balance:value::text)`,
    "balances.key": `in.(${userAddress},${registry.liquidityPool?.address || ''})`
  });

  // Extract token data and user balances
  const borrowableToken = tokenData.find(token => token.address === borrowableAsset);
  const mTokenInfo = tokenData.find(token => token.address === mToken);

  const borrowableBalance = borrowableToken?.balances?.find((b: any) => b.user === userAddress)?.balance || "0";
  const mTokenBalance = mTokenInfo?.balances?.find((b: any) => b.user === userAddress)?.balance || "0";

  // Supply/token state
  const totalMTokenSupply = mTokenInfo?._totalSupply || "0";
  const availableLiquidity = borrowableToken?.balances?.find((b: any) => b.user === registry.liquidityPool?.address)?.balance || "0";

  // Asset config for borrowable asset
  const borrowableAssetConfig = assetConfigs?.find((c: any) => c.asset === borrowableAsset)?.AssetConfig || {};

  // Build price map (USD 1e18)
  const priceMap = new Map<string, string>();
  (registry.oracle?.prices || []).forEach((p: any) => {
    priceMap.set(p.asset, p.price);
  });
  if (!priceMap.has(borrowableAsset)) {
    priceMap.set(borrowableAsset, borrowableToken?.price?.toString() || "0");
  }
  if (!priceMap.has(mToken)) {
    priceMap.set(mToken, mTokenInfo?.price?.toString() || "0");
  }

  // Index/scaled-debt state from Cirrus
  const borrowIndexStr     = registry.lendingPool?.borrowIndex     || "0";
  const totalScaledDebtStr = registry.lendingPool?.totalScaledDebt || "0";
  const reservesAccruedStr = registry.lendingPool?.reservesAccrued || "0";
  const lastAccrualStr     = registry.lendingPool?.lastAccrual     || "0";
  const badDebtStr         = registry.lendingPool?.badDebt         || "0";

  const interestRateBps = borrowableAssetConfig?.interestRate || 0;

  // User’s scaled debt (because we filtered userLoan by key above)
  const userScaledDebtStr =
    (registry.lendingPool?.userLoan || [])
      .find((r: any) => r.user === userAddress)?.LoanInfo?.scaledDebt || "0";

  // Current and projected user debt (underlying 18d)
  const totalAmountOwed = debtFromScaled(userScaledDebtStr, borrowIndexStr.toString());
  const idxPreview = previewBorrowIndexFromFlatApr(
    borrowIndexStr.toString(),
    interestRateBps,
    lastAccrualStr.toString(),
    Math.floor(Date.now() / 1000)
  );
  const totalAmountOwedPreview = debtFromScaled(userScaledDebtStr, idxPreview);

  // Clamp dust (<= 1 wei) to zero for UI cleanliness
  const totalAmountOwedClamped = (() => { try { return (BigInt(totalAmountOwed) <= 1n) ? "0" : totalAmountOwed; } catch { return totalAmountOwed; } })();
  const totalAmountOwedPreviewClamped = (() => { try { return (BigInt(totalAmountOwedPreview) <= 1n) ? "0" : totalAmountOwedPreview; } catch { return totalAmountOwedPreview; } })();

  // System totals and exchange rate
  const systemTotalDebt = totalDebtFromScaled(totalScaledDebtStr.toString(), borrowIndexStr.toString());

  // Get exchange rate from Cirrus events instead of calculating manually
  const exchangeRate = await getExchangeRateFromCirrus(accessToken);

  const totalUSDSTSupplied = (BigInt(availableLiquidity) + BigInt(systemTotalDebt)).toString();

  // Utilization rate: U = debt / (cash + debt − reserves)
  let denom = BigInt(availableLiquidity) + BigInt(systemTotalDebt);
  denom = BigInt(reservesAccruedStr || "0") < denom ? (denom - BigInt(reservesAccruedStr || "0")) : BigInt(availableLiquidity);
  const utilizationRate = denom === 0n ? 0 : Number((BigInt(systemTotalDebt) * 10000n) / denom) / 100;

  // APY from flat APR; supply APY scaled by utilization
  const apyData = calculateAPYs(interestRateBps, (borrowableAssetConfig?.reserveFactor as number) || 1000);
  const supplyAPY = apyData.supplyAPY * (utilizationRate / 100);

  // Total collateral value across all users (USD 1e18)
  const totalCollateralValue = await Promise.resolve(
    calculateTotalCollateralValue(
      registry.lendingPool?.assetConfigs || [],
      allCollaterals,
      priceMap,
      borrowableAsset
    )
  );

  // Get user's staked balance from RewardsChef
  // Find the pool for this mToken
  const rewardsPool = await findPoolByLpToken(accessToken, config.rewardsChef, mToken);

  // If no pool found, staked balance is 0
  const stakedMTokenBalance = rewardsPool
    ? await getStakedBalance(accessToken, config.rewardsChef, rewardsPool.poolIdx, userAddress)
    : "0";

  // User's withdrawable underlying (min of user mToken value and pool cash)
  const userMTokenBalance = BigInt(mTokenBalance);
  const userUSDSTValue = userMTokenBalance > 0n
    ? ((userMTokenBalance * BigInt(exchangeRate)) / (10n ** 18n))
    : 0n;

  const poolAvailableLiquidity = BigInt(availableLiquidity);
  const maxWithdrawableUSDST = userUSDSTValue < poolAvailableLiquidity
    ? userUSDSTValue.toString()
    : poolAvailableLiquidity.toString();

  // Clean token objects
  const { balances: _, ...borrowableTokenClean } = borrowableToken || {};
  const { balances: __, ...mTokenInfoClean } = mTokenInfo || {};

  // Back-compat field
  const totalBorrowPrincipal = systemTotalDebt;

  return {
    supplyable: {
      ...borrowableTokenClean,
      userBalance: borrowableBalance,
    },
    withdrawable: {
      ...mTokenInfoClean,
      userBalance: mTokenBalance, // This is the unstaked (wallet) balance
      userBalanceStaked: stakedMTokenBalance, // Staked balance from RewardsChef
      userBalanceTotal: (BigInt(mTokenBalance) + BigInt(stakedMTokenBalance)).toString(), // Total = wallet + staked
      maxWithdrawableUSDST,
      withdrawValue: userUSDSTValue.toString(),
    },
    totalUSDSTSupplied,
    totalBorrowed: systemTotalDebt,
    utilizationRate,
    availableLiquidity,
    totalCollateralValue,
    supplyAPY: Math.floor(supplyAPY * 100) / 100,
    maxSupplyAPY: Math.floor(apyData.supplyAPY * 100) / 100,
    borrowAPY: Math.floor(apyData.borrowAPY * 100) / 100,
    exchangeRate,
    // Additional pool metrics
    borrowIndex: borrowIndexStr.toString(),
    reservesAccrued: reservesAccruedStr.toString(),
    // New index-based fields for UI:
    totalAmountOwed: totalAmountOwedClamped,
    totalAmountOwedPreview: totalAmountOwedPreviewClamped,
    // Compat:
    totalBorrowPrincipal,
    // Pause status
    isPaused,
  };
};

export const getLoan = async (
  accessToken: string,
  userAddress: string | undefined
): Promise<any> => {
  // Fetch registry; explicit select with borrowIndex so simulateLoan can compute debt
  const registry = await getPool(accessToken, {
    select:
      `lendingPool:lendingPool_fkey(` +
        `address,borrowableAsset,mToken,` +
        `borrowIndex::text,` +
        `assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value),` +
        `userLoan:${LendingPool}-userLoan(user:key,LoanInfo:value)` +
      `),` +
      `collateralVault:collateralVault_fkey(` +
        `userCollaterals:${CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text)` +
      `),` +
      `oracle:priceOracle_fkey(address,` +
        `prices:${PriceOracle}-prices(asset:key,price:value::text)` +
      `),` +
      `liquidityPool:liquidityPool_fkey(address)`
  });

  const borrowIndex = registry.lendingPool?.borrowIndex || "0";
  const borrowableAsset = registry.lendingPool?.borrowableAsset;

  // Build asset configs map (with prices) for health/limits
  const assetConfigs = new Map<string, AssetConfig>();
  (registry.lendingPool?.assetConfigs || []).forEach((config: any) => {
    const price = registry.oracle?.prices?.find((p: any) => p.asset === config.asset)?.price || "0";
    assetConfigs.set(config.asset, {
      interestRate: config.AssetConfig?.interestRate || 0,
      liquidationThreshold: config.AssetConfig?.liquidationThreshold || 0,
      ltv: config.AssetConfig?.ltv || 0,
      price,
    });
  });

  if (userAddress) {
    const userLoanEntry = registry.lendingPool?.userLoan?.find((loan: any) => loan.user === userAddress);
    const userLoan = userLoanEntry?.LoanInfo;
    const userCollaterals: CollateralInfo[] = (registry.collateralVault?.userCollaterals || [])
      .filter((c: any) => c.user === userAddress)
      .map((c: any) => ({ asset: c.asset, amount: c.amount }));

    return simulateLoan(userLoan || null, userCollaterals, assetConfigs, borrowIndex, borrowableAsset);
  }

  // All users
  const allLoans: any[] = [];
  const allUserLoans = registry.lendingPool?.userLoan || [];
  for (const loanEntry of allUserLoans) {
    const userLoan = loanEntry.LoanInfo;
    const userAddr = loanEntry.user;
    if (!userLoan || !userAddr) continue;

    const userCollaterals: CollateralInfo[] = (registry.collateralVault?.userCollaterals || [])
      .filter((c: any) => c.user === userAddr)
      .map((c: any) => ({ asset: c.asset, amount: c.amount }));

    const simulatedLoan = simulateLoan(userLoan || null, userCollaterals, assetConfigs, borrowIndex, borrowableAsset);
    allLoans.push({ user: userAddr, ...simulatedLoan });
  }

  return allLoans;
};

export const repayAll = async (
  accessToken: string,
  userAddress: string
) => {
  const registry = await getPool(accessToken, {
    select:
      `lendingPool:lendingPool_fkey(` +
        `address,borrowableAsset,borrowIndex::text,` +
        `userLoan:${LendingPool}-userLoan(user:key,LoanInfo:value)` +
      `),` +
      `liquidityPool:liquidityPool_fkey(address)`
  ,
    "lendingPool.userLoan.key": `eq.${userAddress}`
  } as any);

  const lendingPoolAddr = registry.lendingPool?.address as string;
  const liquidityPoolAddr = registry.liquidityPool?.address as string;
  const borrowableAsset = registry.lendingPool?.borrowableAsset as string;
  if (!lendingPoolAddr || !liquidityPoolAddr || !borrowableAsset) {
    throw new Error("Required pool addresses not found");
  }

  const borrowIndexStr = registry.lendingPool?.borrowIndex || "0";
  const loanEntry = (registry.lendingPool?.userLoan || []).find((r: any) => r.user === userAddress);
  const scaledDebt = loanEntry?.LoanInfo?.scaledDebt || "0";
  const exactDebtWei = BigInt(debtFromScaled(scaledDebt, borrowIndexStr));

  const MAX_UINT256 = ((1n << 256n) - 1n).toString();

  // Single tx: approve MAX + on-chain repayAll
  const tx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: borrowableAsset,
      method: "approve",
      args: { spender: liquidityPoolAddr, value: MAX_UINT256 },
    },
    {
      contractName: extractContractName(LendingPool),
      contractAddress: lendingPoolAddr,
      method: "repayAll",
      args: {},
    },
  ];

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );

  return {
    status,
    hash,
    amountRequested: MAX_UINT256,
    estimatedDebtAtRead: exactDebtWei.toString(),
  };
};

export const executeLiquidation = async (
  accessToken: string,
  userAddress: string,
  loanId: string,
  options: { collateralAsset?: string; repayAmount?: string | number | bigint; minCollateralOut?: string | number | bigint } = {}
) => {
  // LiquidityPool address
  const { liquidityPool } = await getPool(accessToken, { select: "liquidityPool" });
  if (!liquidityPool || typeof liquidityPool !== "string") {
    throw new Error("Liquidity pool address not found");
  }
  const liquidityPoolAddr = liquidityPool;

  // Borrower-specific data
  const registry = await getPool(accessToken, {
    select:
      `lendingPool:lendingPool_fkey(` +
        `address,borrowableAsset,borrowIndex::text,` +
        `assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value),` +
        `userLoan:${LendingPool}-userLoan(user:key,LoanInfo:value)` +
      `),` +
      `collateralVault:collateralVault_fkey(` +
        `userCollaterals:${CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text)` +
      `),` +
      `oracle:priceOracle_fkey(address,` +
        `prices:${PriceOracle}-prices(asset:key,price:value::text)` +
      `)`,
    "lendingPool.userLoan.key": `eq.${loanId}`,
  });

  const loanRow = registry.lendingPool?.userLoan?.[0];
  if (!loanRow?.LoanInfo) {
    throw new Error(`Loan ${loanId} not found`);
  }
  const loan = loanRow.LoanInfo;

  const priceMap = new Map<string, string>();
  (registry.oracle?.prices || []).forEach((p: any) => priceMap.set(p.asset, p.price));

  const assetConfigMap = new Map<string, any>();
  (registry.lendingPool?.assetConfigs || []).forEach((cfg: any) => {
    assetConfigMap.set(cfg.asset, cfg.AssetConfig);
  });

  const userCollaterals = (registry.collateralVault?.userCollaterals || [])
    .filter((c: any) => c.user === loanId)
    .map((c: any) => ({ asset: c.asset, amount: c.amount })) as CollateralInfo[];

  const borrowIndexStr = registry.lendingPool?.borrowIndex || "0";
  const borrowableAsset = registry.lendingPool?.borrowableAsset as string;
  if (!borrowableAsset) {
    throw new Error("Borrowable asset not found");
  }

  // Determine repayAmount
  let repayAmount: bigint;
  const treatAsAll = options.repayAmount === undefined || options.repayAmount === "ALL";
  if (!treatAsAll) {
    repayAmount = toBig(options.repayAmount as string | number | bigint);
  } else {
    // Index-based total owed (exact as of read time)
    const totalOwed = toBig(debtFromScaled(loan.scaledDebt || "0", borrowIndexStr.toString()));

    // Health factor to decide close factor (100% or 50%)
    const healthFactorRaw = calculateHealthFactor(
      calculateTotalCollateralValueForHealth(
        userCollaterals,
        new Map(
          Array.from(assetConfigMap.entries()).map(([asset, cfg]) => [
            asset,
            {
              price: priceMap.get(asset) || "0",
              liquidationThreshold: cfg?.liquidationThreshold || 0,
              interestRate: cfg?.interestRate || 0,
            },
          ])
        )
      ),
      totalOwed.toString()
    );
    const hfPct = Number(toBig(healthFactorRaw)) / Number(constants.DECIMALS);
    const debtLimit = hfPct <= 0.95 ? totalOwed : totalOwed / 2n;

    const chosenCollateral = options.collateralAsset || userCollaterals[0]?.asset;
    if (!chosenCollateral) {
      throw new Error("Unable to determine collateral asset for liquidation");
    }

    // Ceil-based collateral coverage
    const priceDebt = toBig(priceMap.get(borrowableAsset) || "0");
    const priceColl = toBig(priceMap.get(chosenCollateral) || "0");
    const collateralAmt = toBig(
      (userCollaterals.find((c) => c.asset === chosenCollateral) as any)?.amount || "0"
    );
    const liqBonus = BigInt(
      (assetConfigMap.get(chosenCollateral)?.liquidationBonus as number) || 10500
    );

    let ceilCollateralCover = debtLimit;
    if (priceDebt > 0n && priceColl > 0n) {
      const num = collateralAmt * priceColl * 10000n;
      const den = priceDebt * liqBonus;
      ceilCollateralCover = (num + den - 1n) / den;
    }

    // Final repay amount: min(total owed, protocol close factor limit, and collateral coverage)
    const base = debtLimit < totalOwed ? debtLimit : totalOwed;
    repayAmount = ceilCollateralCover <= base ? ceilCollateralCover : base;
  }

  // For ALL path, approve MAX_UINT256 to avoid under-allowance if debt/coverage shifts before execution
  const MAX_UINT256 = ((1n << 256n) - 1n).toString();
  const approveValue = treatAsAll ? MAX_UINT256 : repayAmount.toString();

  const repayAmountAtomic = repayAmount.toString();
  const minCollateralOutAtomic = options.minCollateralOut 
    ? toBig(options.minCollateralOut).toString() 
    : "0";

  const tx = await buildFunctionTx([
    {
      contractName: extractContractName(Token),
      contractAddress: borrowableAsset,
      method: "approve",
      args: { spender: liquidityPoolAddr, value: approveValue },
    },
    {
      contractName: extractContractName(LendingPool),
      contractAddress: registry.lendingPool?.address,
      method: treatAsAll ? "liquidationCallAll" : "liquidationCall",
      args: treatAsAll ? {
        collateralAsset: options.collateralAsset || userCollaterals[0]?.asset,
        borrower: loanId,
        minCollateralOut: minCollateralOutAtomic,
      } : {
        collateralAsset: options.collateralAsset || userCollaterals[0]?.asset,
        borrower: loanId,
        debtToCover: repayAmountAtomic,
        minCollateralOut: minCollateralOutAtomic,
      },
    },
  ], userAddress, accessToken);

  try {
    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );
    return { status, hash, repayAmount: repayAmount.toString() };
  } catch (error: any) {
    const msg = error?.response?.data?.message || error.message || "";
    if (typeof msg === "string" && msg.includes("Invalid borrower")) {
      throw new Error(
        "Self-liquidation is not allowed. Use a different account to liquidate this position."
      );
    }
    throw error;
  }
};

export const configureAsset = async (
  accessToken: string,
  userAddress: string,
  body: Record<string, string | number>
) => {
  if (!body.asset || body.ltv === undefined || body.liquidationThreshold === undefined || 
      body.liquidationBonus === undefined || body.interestRate === undefined || 
      body.reserveFactor === undefined || body.perSecondFactorRAY === undefined) {
    throw new Error("Missing required parameters: asset, ltv, liquidationThreshold, liquidationBonus, interestRate, reserveFactor, perSecondFactorRAY");
  }

  const ltv = Number(body.ltv);
  const liquidationThreshold = Number(body.liquidationThreshold);
  const liquidationBonus = Number(body.liquidationBonus);
  const interestRate = Number(body.interestRate);
  const reserveFactor = Number(body.reserveFactor);
  const perSecondFactorRAY = String(body.perSecondFactorRAY); // Keep as string for BigInt precision

  if (isNaN(ltv) || ltv < 100 || ltv > 9500) throw new Error("LTV must be between 100 and 9500 basis points (1% to 95%)");
  if (isNaN(liquidationThreshold) || liquidationThreshold < 100 || liquidationThreshold > 9500) throw new Error("Liquidation threshold must be between 100 and 9500 basis points (1% to 95%)");
  if (isNaN(liquidationBonus) || liquidationBonus < 10000 || liquidationBonus > 12500) throw new Error("Liquidation bonus must be between 10000 and 12500 basis points (100% to 125%)");
  if (isNaN(interestRate) || interestRate < 0 || interestRate > 10000) throw new Error("Interest rate must be between 0 and 10000 basis points (0% to 100%)");
  if (isNaN(reserveFactor) || reserveFactor < 0 || reserveFactor > 5000) throw new Error("Reserve factor must be between 0 and 5000 basis points (0% to 50%)");
  if (ltv > liquidationThreshold) throw new Error("LTV cannot be higher than liquidation threshold");
  
  // Validate perSecondFactorRAY
  if (!/^\d+$/.test(perSecondFactorRAY)) throw new Error("perSecondFactorRAY must be a valid integer string");
  const rayValue = BigInt(perSecondFactorRAY);
  const minRAY = BigInt('1000000000000000000000000000'); // 1e27
  if (rayValue < minRAY) throw new Error("perSecondFactorRAY must be >= 1e27 (1 RAY)");

  const tx = await buildFunctionTx({
    contractName: extractContractName(constants.PoolConfigurator),
    contractAddress: config.poolConfigurator,
    method: "configureAsset",
    args: {
      asset: body.asset,
      ltv,
      liquidationThreshold,
      liquidationBonus,
      interestRate,
      reserveFactor,
      perSecondFactorRAY,
    },
  }, userAddress, accessToken);

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash };
};

export const sweepReserves = async (
  accessToken: string,
  userAddress: string,
  body: Record<string, string | number>
) => {
  if (!body.amount) {
    throw new Error("Missing required parameter: amount");
  }

  const amount = body.amount.toString();

  // Validate amount is a valid number string
  if (!/^\d+$/.test(amount)) {
    throw new Error("Amount must be a valid positive integer");
  }

  const tx = await buildFunctionTx({
    contractName: extractContractName(constants.PoolConfigurator),
    contractAddress: config.poolConfigurator,
    method: "sweepReserves",
    args: {
      amount,
    },
  }, userAddress, accessToken);

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash };
};

export const setDebtCeilings = async (
  accessToken: string,
  userAddress: string,
  body: Record<string, string | number>
) => {
  if (!body.assetUnits || !body.usdValue) {
    throw new Error("Missing required parameters: assetUnits and usdValue");
  }

  const assetUnits = body.assetUnits.toString();
  const usdValue = body.usdValue.toString();

  // Validate both parameters are valid number strings
  if (!/^\d+$/.test(assetUnits)) {
    throw new Error("Asset units must be a valid number");
  }
  if (!/^\d+$/.test(usdValue)) {
    throw new Error("USD value must be a valid number"); // convert to BigInt before making the API call.
  }

  const tx = await buildFunctionTx({
    contractName: extractContractName(constants.PoolConfigurator),
    contractAddress: config.poolConfigurator,
    method: "setDebtCeilings",
    args: {
      assetUnits,
      usdValue,
    },
  }, userAddress, accessToken);

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash };
};

// ---------------- Liquidation Listing Helpers ----------------

export interface LiquidationCollateralInfo {
  asset: string;
  symbol?: string;
  amount: string;
  usdValue: string;
  expectedProfit: string;
  maxRepay?: string;
  liquidationBonus?: number;
}

export interface LiquidationEntry {
  id: string;
  user: string;
  asset: string;
  assetSymbol?: string;
  amount: string;          // current debt (underlying 18d)
  healthFactor: number;    // percentage (e.g., 0.85 for 85%)
  collaterals: LiquidationCollateralInfo[];
  maxRepay?: string;
}

export const listLoansForLiquidation = async (
  accessToken: string,
  margin?: number
): Promise<LiquidationEntry[]> => {
  const select =
    `lendingPool:lendingPool_fkey(` +
      `address,` +
      `borrowableAsset,` +
      `borrowIndex::text,` +
      `_paused,` +
      `assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value),` +
      `loans:${LendingPool}-userLoan(user:key,LoanInfo:value)` +
    `),` +
    `collateralVault:collateralVault_fkey(` +
      `userCollaterals:${CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text)` +
    `),` +
    `oracle:priceOracle_fkey(` +
      `prices:${PriceOracle}-prices(asset:key,price:value::text)` +
    `)`;

  const registry = await getPool(accessToken, { select });

  const borrowableAsset: string = registry.lendingPool?.borrowableAsset;
  const borrowIndexStr = registry.lendingPool?.borrowIndex || "0";
  const isPaused = registry.lendingPool?._paused;
  const assetConfigsArr = registry.lendingPool?.assetConfigs || [];
  const loansArr = registry.lendingPool?.loans || [];
  const collateralsArr = registry.collateralVault?.userCollaterals || [];
  const pricesArr = registry.oracle?.prices || [];

  const priceMap = new Map<string, string>(pricesArr.map((p: any) => [p.asset, p.price]));

  const assetConfigMap = new Map<string, any>();
  assetConfigsArr.forEach((cfg: any) => assetConfigMap.set(cfg.asset, cfg.AssetConfig));

  const collMap = new Map<string, CollateralInfo[]>();
  for (const c of collateralsArr) {
    const list = collMap.get(c.user) || [];
    list.push({ asset: c.asset, amount: c.amount });
    collMap.set(c.user, list);
  }

  const tokenSet = new Set<string>([borrowableAsset]);
  collateralsArr.forEach((c: any) => tokenSet.add(c.asset));
  let tokenInfoMap = new Map<string, any>();
  try {
    const tokenRows = await getTokens(accessToken, {
      address: `in.(${Array.from(tokenSet).join(',')})`,
      select: "address,_symbol,_name"
    });
    tokenInfoMap = new Map<string, any>(tokenRows.map((t: any) => [t.address, t]));
  } catch {}

  const results: LiquidationEntry[] = [];

  for (const entry of loansArr) {
    const userAddr: string = entry.user || entry.key;
    const loanInfo = entry.LoanInfo;
    if (!userAddr || !loanInfo) continue;

    const userColls = collMap.get(userAddr) || [];

    // Index-based current debt
    const userScaledDebtStr = loanInfo.scaledDebt || "0";
    const totalAmountOwed = debtFromScaled(userScaledDebtStr, borrowIndexStr.toString());

    // Health factor
    const hfRaw = calculateHealthFactor(
      calculateTotalCollateralValueForHealth(
        userColls,
        new Map(
          Array.from(assetConfigMap.entries()).map(([asset, cfg]) => [
            asset,
            {
              price: priceMap.get(asset) || "0",
              liquidationThreshold: cfg?.liquidationThreshold || 0,
              interestRate: cfg?.interestRate || 0,
            },
          ])
        )
      ),
      totalAmountOwed
    );
    const hf = Number(toBig(hfRaw)) / Number(constants.DECIMALS);

    const include = margin === undefined ? hf < 1 : hf >= 1 && hf < 1 + margin;
    if (!include) continue;

    const totalOwedBig = toBig(totalAmountOwed);
    const debtLimit = hf <= 0.95 ? totalOwedBig : totalOwedBig / 2n;

    const collateralDisplay: LiquidationCollateralInfo[] = userColls.map((col) => {
      const price = priceMap.get(col.asset) || "0";
      const collateralValueWei = (toBig(col.amount) * toBig(price)) / constants.DECIMALS;
      const tokenInfo = tokenInfoMap.get(col.asset);

      const assetCfg = assetConfigMap.get(col.asset);
      const liquidationBonus = assetCfg?.liquidationBonus || 10500;

      const priceDebtStr = priceMap.get(borrowableAsset) || "0";
      const priceDebt = toBig(priceDebtStr);
      const priceCollBig = toBig(price);
      const collateralAmtBig = toBig(col.amount);

      let collateralLimit = 0n;
      if (priceDebt > 0n && priceCollBig > 0n) {
        collateralLimit =
          (collateralAmtBig * priceCollBig * 10000n) /
          (priceDebt * BigInt(liquidationBonus));
      }

      const effectiveMaxRepay = debtLimit < collateralLimit ? debtLimit : collateralLimit;
      const profitFactor = BigInt(liquidationBonus - 10000);
      const expectedProfit = (effectiveMaxRepay * profitFactor) / 10000n;

      return {
        asset: col.asset,
        symbol: tokenInfo?._symbol || tokenInfo?._name,
        amount: col.amount,
        usdValue: collateralValueWei.toString(),
        expectedProfit: expectedProfit.toString(),
        maxRepay: effectiveMaxRepay.toString(),
        liquidationBonus,
        isPaused,
      };
    })
    // Filter out zero-amount or zero-USD-value collaterals
    .filter((c) => {
      try {
        return BigInt(c.amount || "0") > 0n && BigInt(c.usdValue || "0") > 0n;
      } catch {
        return true;
      }
    });

    // If nothing left to seize, skip showing this loan in the liquidations list
    if (collateralDisplay.length === 0) {
      continue;
    }

    const tokenBorrowInfo = tokenInfoMap.get(borrowableAsset);

    results.push({
      id: userAddr,
      user: userAddr,
      asset: borrowableAsset,
      assetSymbol: tokenBorrowInfo?._symbol || tokenBorrowInfo?._name,
      amount: totalAmountOwed,
      healthFactor: hf,
      collaterals: collateralDisplay,
      maxRepay: debtLimit.toString(),
    });
  }

  return results;
};

export const listLiquidatableLoans = async (accessToken: string): Promise<LiquidationEntry[]> => {
  return listLoansForLiquidation(accessToken);
};

export const listNearUnhealthyLoans = async (accessToken: string, margin: number): Promise<LiquidationEntry[]> => {
  return listLoansForLiquidation(accessToken, margin);
};

export const withdrawCollateralMax = async (
  accessToken: string,
  userAddress: string,
  asset: string,
) => {
  const { lendingPool } = await getPool(accessToken, { select: "lendingPool" });
  if (!lendingPool) {
    throw new Error("Lending pool address not found");
  }
  const builtTx = await buildFunctionTx({
    contractName: extractContractName(LendingPool),
    contractAddress: lendingPool,
    method: "withdrawCollateralMax",
    args: { asset },
  }, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const pauseLendingPool = async (
  accessToken: string,
  userAddress: string,
) => {
  const { lendingPool } = await getPool(accessToken, { select: "lendingPool" });
  if (!lendingPool) {
    throw new Error("Lending pool address not found");
  }
  const builtTx = await buildFunctionTx({
    contractName: extractContractName(LendingPool),
    contractAddress: lendingPool,
    method: "pause",
    args: {},
  }, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const unpauseLendingPool = async (
  accessToken: string,
  userAddress: string,
) => {
  const { lendingPool } = await getPool(accessToken, { select: "lendingPool" });
  if (!lendingPool) {
    throw new Error("Lending pool address not found");
  }
  const builtTx = await buildFunctionTx({
    contractName: extractContractName(LendingPool),
    contractAddress: lendingPool,
    method: "unpause",
    args: {},
  }, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

// ============================================================================
// REVENUE OPERATIONS
// ============================================================================

/**
 * Helper function to get token info
 */
const getTokenInfo = async (
  accessToken: string,
  tokenAddress: string
): Promise<{ symbol: string }> => {
  const { data } = await cirrus.get(accessToken, `/${Token}`, {
    params: {
      address: "eq." + tokenAddress,
      select: "_symbol",
    }
  });
  const token = data?.[0];
  return {
    symbol: token?._symbol || "UNKNOWN"
  };
};

/**
 * Get fee collector address from LendingPool
 */
const getFeeCollector = async (
  accessToken: string,
  lendingPoolAddress: string
): Promise<string> => {
  const { data: poolData } = await cirrus.get(accessToken, `/${LendingPool}`, {
    params: { 
      address: `eq.${lendingPoolAddress}`, 
      select: "feeCollector" 
    }
  });
  
  if (!poolData || poolData.length === 0 || !poolData[0].feeCollector) {
    throw new Error("Fee collector address not found in LendingPool");
  }
  
  return poolData[0].feeCollector;
};

/**
 * Get protocol revenue from lending pool operations
 * Queries Transfer events from lending pool to feeCollector
 */
export const getLendingProtocolRevenue = async (
  accessToken: string,
): Promise<{ 
  totalRevenue: string; 
  revenueByPeriod: {
    daily: {
      total: string;
      byAsset: Array<{asset: string; symbol: string; revenue: string;}>;
    };
    weekly: {
      total: string;
      byAsset: Array<{asset: string; symbol: string; revenue: string;}>;
    };
    monthly: {
      total: string;
      byAsset: Array<{asset: string; symbol: string; revenue: string;}>;
    };
    ytd: {
      total: string;
      byAsset: Array<{asset: string; symbol: string; revenue: string;}>;
    };
    allTime: {
      total: string;
      byAsset: Array<{asset: string; symbol: string; revenue: string;}>;
    };
  };
}> => {
  try {
    // Get lending pool address from registry
    const { lendingPool: lendingPoolAddress, liquidityPool: liquidityPoolAddress } = await getPool(accessToken, { 
      select: "lendingPool,liquidityPool" 
    });
    
    if (!lendingPoolAddress || !liquidityPoolAddress) {
      throw new Error("Lending pool address not found");
    }
    
    // Get fee collector address from lending pool
    const feeCollector = await getFeeCollector(accessToken, lendingPoolAddress);
    
    // Query all Transfer events where 'from' is the lending pool and 'to' is feeCollector
    const { data: tokenTransferEvents } = await cirrus.get(accessToken, `/event`, {
      params: {
        event_name: `eq.Transfer`,
        select: "address,attributes,block_timestamp",
        "attributes->>from": `eq.${liquidityPoolAddress}`,
        "attributes->>to": `eq.${feeCollector}`,
        order: "block_timestamp.desc"
      }
    });
    
    if (!tokenTransferEvents || tokenTransferEvents.length === 0) {
      console.log("No transfer events found for fee collector in lending pool");
      return {
        totalRevenue: "0",
        revenueByPeriod: {
          daily: { total: "0", byAsset: [] },
          weekly: { total: "0", byAsset: [] },
          monthly: { total: "0", byAsset: [] },
          ytd: { total: "0", byAsset: [] },
          allTime: { total: "0", byAsset: [] }
        }
      };
    }
   
    console.log("lending pool address", lendingPoolAddress);
    console.log("tokenTransferEvents length", tokenTransferEvents.length);
    console.log("tokenTransferEvents total revenue", tokenTransferEvents.reduce((acc: any, event: any) => acc + BigInt(event.attributes?.value || "0"), 0n));
    
    // Calculate time cutoffs
    const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds
    const oneDayAgo = now - (24 * 60 * 60);
    const oneWeekAgo = now - (7 * 24 * 60 * 60);
    const oneMonthAgo = now - (30 * 24 * 60 * 60);
    // Calculate YTD cutoff (January 1st of current year)
    const currentYear = new Date().getFullYear();
    const ytdCutoff = Math.floor(new Date(currentYear, 0, 1).getTime() / 1000);
    
    // Revenue tracking structures - by token address
    let totalRevenue = 0n;
    const revenueByToken: Record<string, bigint> = {};
    
    // Revenue by token for each time period
    const dailyRevenueByToken: Record<string, bigint> = {};
    const weeklyRevenueByToken: Record<string, bigint> = {};
    const monthlyRevenueByToken: Record<string, bigint> = {};
    const ytdRevenueByToken: Record<string, bigint> = {};
    
    tokenTransferEvents.forEach((event: any) => {
      const value = BigInt(event.attributes?.value || "0");
      const tokenAddress = event.address.toLowerCase(); // The token that emitted the Transfer event
      
      // Convert block_timestamp string to Unix timestamp in seconds
      const timestampDate = new Date(event.block_timestamp);
      if (isNaN(timestampDate.getTime())) {
        console.error(`Invalid timestamp format: ${event.block_timestamp}`);
        return;
      }
      const timestamp = Math.floor(timestampDate.getTime() / 1000);
      
      // Skip if value is 0
      if (value === 0n) {
        return;
      }
      
      totalRevenue += value;
      
      // Track all-time by token
      if (!revenueByToken[tokenAddress]) {
        revenueByToken[tokenAddress] = 0n;
      }
      revenueByToken[tokenAddress] += value;
      
      // Track by time period and token
      if (timestamp >= oneDayAgo) {
        if (!dailyRevenueByToken[tokenAddress]) dailyRevenueByToken[tokenAddress] = 0n;
        dailyRevenueByToken[tokenAddress] += value;
      }
      if (timestamp >= oneWeekAgo) {
        if (!weeklyRevenueByToken[tokenAddress]) weeklyRevenueByToken[tokenAddress] = 0n;
        weeklyRevenueByToken[tokenAddress] += value;
      }
      if (timestamp >= oneMonthAgo) {
        if (!monthlyRevenueByToken[tokenAddress]) monthlyRevenueByToken[tokenAddress] = 0n;
        monthlyRevenueByToken[tokenAddress] += value;
      }
      if (timestamp >= ytdCutoff) {
        if (!ytdRevenueByToken[tokenAddress]) ytdRevenueByToken[tokenAddress] = 0n;
        ytdRevenueByToken[tokenAddress] += value;
      }
    });
    
    // Get unique tokens and fetch their info
    const uniqueTokens = Object.keys(revenueByToken);
    const tokenInfoPromises = uniqueTokens.map(async (token) => {
      try {
        const info = await getTokenInfo(accessToken, token);
        return { asset: token, symbol: info.symbol };
      } catch (error) {
        console.error(`Error fetching token info for ${token}:`, error);
        return { asset: token, symbol: 'Unknown' };
      }
    });
    
    const tokenInfos = await Promise.all(tokenInfoPromises);
    const tokenSymbolMap: Record<string, string> = {};
    tokenInfos.forEach(({ asset, symbol }) => {
      tokenSymbolMap[asset] = symbol;
    });
    
    // Helper function to build asset array with symbols
    const buildAssetArray = (tokenRevenue: Record<string, bigint>) => {
      const arr = Object.entries(tokenRevenue).map(([token, revenue]) => ({
        asset: token,
        symbol: tokenSymbolMap[token] || 'Unknown',
        revenue: revenue.toString()
      }));
      
      // Sort by revenue descending
      arr.sort((a, b) => {
        const revenueA = BigInt(a.revenue);
        const revenueB = BigInt(b.revenue);
        if (revenueA > revenueB) return -1;
        if (revenueA < revenueB) return 1;
        return 0;
      });
      
      return arr;
    };
    
    // Build response arrays for all periods
    const allTimeArray = buildAssetArray(revenueByToken);
    const dailyArray = buildAssetArray(dailyRevenueByToken);
    const weeklyArray = buildAssetArray(weeklyRevenueByToken);
    const monthlyArray = buildAssetArray(monthlyRevenueByToken);
    const ytdArray = buildAssetArray(ytdRevenueByToken);
    
    // Calculate totals for each period
    const dailyTotal = Object.values(dailyRevenueByToken).reduce((sum, val) => sum + val, 0n);
    const weeklyTotal = Object.values(weeklyRevenueByToken).reduce((sum, val) => sum + val, 0n);
    const monthlyTotal = Object.values(monthlyRevenueByToken).reduce((sum, val) => sum + val, 0n);
    const ytdTotal = Object.values(ytdRevenueByToken).reduce((sum, val) => sum + val, 0n);
    
    return {
      totalRevenue: totalRevenue.toString(),
      revenueByPeriod: {
        daily: {
          total: dailyTotal.toString(),
          byAsset: dailyArray
        },
        weekly: {
          total: weeklyTotal.toString(),
          byAsset: weeklyArray
        },
        monthly: {
          total: monthlyTotal.toString(),
          byAsset: monthlyArray
        },
        ytd: {
          total: ytdTotal.toString(),
          byAsset: ytdArray
        },
        allTime: {
          total: totalRevenue.toString(),
          byAsset: allTimeArray
        }
      }
    };
  } catch (error: any) {
    console.error("Error fetching lending protocol revenue:", {
      error: error.response?.data || error.message
    });
    throw new Error("Failed to fetch lending protocol revenue");
  }
};
