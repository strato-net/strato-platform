import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { getBalance } from "./tokens.service";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";
import { 
  simulateLoan, 
  CollateralInfo, 
  AssetConfig, 
  calculateCollateralMetrics, 
  calculateAccruedInterest,
  calculateExchangeRate,
  calculateTotalUSDSTSupplied,
  calculateTotalBorrowed,
  calculateUtilizationRate,
  calculateTotalCollateralValue,
  calculateTotalCollateralValueForHealth,
  calculateHealthFactor,
  calculateAPYs,
  toBig,
} from "../helpers/lending.helper";

const {
  registrySelectFields,
  lendingRegistry,
  LendingPool,
  LendingRegistry,
  Token,
  CollateralVault,
  PriceOracle,
} = constants;

export const getPool = async (
  accessToken: string,
  userAddress: string | undefined,
  options: Record<string, string> = {}
): Promise<Record<string, any>> => {
  const { select, ...filters } = options;
  const cleanedFilters = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined)
  );
  const params = {
    ...cleanedFilters,
    select: select ?? registrySelectFields.join(","),
    ...(select
      ? {}
      : {
          "lendingPool.userLoan.key": `eq.${userAddress}`,
          "collateralVault.userCollaterals.key": `eq.${userAddress}`,
        }),
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
  amount: string,
) => {
  const { liquidityPool, lendingPool, borrowableAsset: { borrowableAsset } } = await getPool(
    accessToken,
    undefined,
    {
      select: `liquidityPool,lendingPool,borrowableAsset:lendingPool_fkey(borrowableAsset)`,
    } as Record<string, string>
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
      method: "depositLiquidity",
      args: { amount },
    },
  ];

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx(tx))
  );
};

export const withdrawLiquidity = async (
  accessToken: string,
  amount: string,
) => {
  const { lendingPool } = await getPool(accessToken, undefined, { select: "lendingPool" });
  if (!lendingPool) {
    throw new Error("Lending pool address not found");
  }

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx({
      contractName: extractContractName(LendingPool),
      contractAddress: lendingPool,
      method: "withdrawLiquidity",
      args: { amount },
    }))
  );
};

export const supplyCollateral = async (
  accessToken: string,
  asset: string,
  amount: string,
) => {
  const { lendingPool, collateralVault } = await getPool(accessToken, undefined, { select: "lendingPool,collateralVault" });
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

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx(tx))
  );
};

export const withdrawCollateral = async (
  accessToken: string,
  asset: string,
  amount: string,
) => {
  const { lendingPool } = await getPool(accessToken, undefined, { select: "lendingPool" });
  if (!lendingPool) {
    throw new Error("Lending pool address not found");
  }

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx({
      contractName: extractContractName(LendingPool),
      contractAddress: lendingPool,
      method: "withdrawCollateral",
      args: { asset, amount },
    }))
  );
};

export const borrow = async (
  accessToken: string,
  amount: string,
) => {
  const { lendingPool } = await getPool(accessToken, undefined, { select: "lendingPool" });
  
  if (!lendingPool) {
    throw new Error("Lending pool address not found");
  }

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx({
      contractName: extractContractName(LendingPool),
      contractAddress: lendingPool,
      method: "borrow",
      args: { amount },
    }))
  );
};

export const repay = async (
  accessToken: string,
  amount: string,
) => {
  const { liquidityPool, lendingPool, borrowableAsset: { borrowableAsset } } = await getPool(
    accessToken,
    undefined,
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

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx(tx))
  );
};

export const collateralAndBalance = async (
  accessToken: string,
  userAddress: string,
) => {
  const registry = await getPool(accessToken, undefined, { 
    select: `lendingPool:lendingPool_fkey(assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value),borrowableAsset),collateralVault:collateralVault_fkey(userCollaterals:${CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text)),oracle:priceOracle_fkey(prices:${PriceOracle}-prices(asset:key,price:value::text))`,
    "collateralVault.userCollaterals.key": `eq.${userAddress}`
  });

  if (!registry.lendingPool || !registry.collateralVault) {
    throw new Error("Lending pool or collateral vault not found");
  }

  const assets = registry.lendingPool.assetConfigs?.map((a: any) => a.asset).filter((asset: string) => asset !== registry.lendingPool.borrowableAsset) || [];
  const userCollaterals = registry.collateralVault.userCollaterals || [];
  const userTokens = await getBalance(accessToken, userAddress, {
    address: `in.(${assets.join(",")})`, select: `address,user:key,balance:value::text,token:${Token}(_name,_symbol,_owner,_totalSupply::text,customDecimals)`
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
      return token && BigInt(token.balance || "0") > 0n;
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
        // Add additional context
        assetPrice,
        ltv,
        liquidationThreshold,
      };
    });
};

export const liquidityAndBalance = async (
  accessToken: string,
  userAddress: string,
) => {
  // Fetch pool data
  const registry = await getPool(accessToken, undefined, { 
    select: `lendingPool:lendingPool_fkey(borrowableAsset,mToken,assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value),userLoan:${LendingPool}-userLoan(user:key,LoanInfo:value)),collateralVault:collateralVault_fkey(userCollaterals:${CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text)),oracle:priceOracle_fkey(prices:${PriceOracle}-prices(asset:key,price:value::text))`
  });
  
  const { borrowableAsset, mToken, assetConfigs, userLoan } = registry.lendingPool || {};
  const allCollaterals = registry.collateralVault?.userCollaterals || [];
  
  if (!borrowableAsset || !mToken) {
    throw new Error("Lending pool, borrowable asset, or mToken not found");
  }

  // Get user balances
  const [borrowableBalance, mTokenBalance] = await Promise.all([
    getBalance(accessToken, userAddress, { 
      address: `eq.${borrowableAsset}`,
      select: `address,user:key,balance:value::text,token:${Token}(_name,_symbol,_owner,_totalSupply::text,customDecimals)`
    }),
    getBalance(accessToken, userAddress, { 
      address: `eq.${mToken}`,
      select: `address,user:key,balance:value::text,token:${Token}(_name,_symbol,_owner,_totalSupply::text,customDecimals)`
    })
  ]).then(balances => balances.map(b => b[0]));

  // Get borrowable asset config and price
  const borrowableAssetConfig = assetConfigs?.find((config: any) => config.asset === borrowableAsset)?.AssetConfig;

  // Build price map for helper functions
  const priceMap = new Map<string, string>(
    registry.oracle?.prices?.map((price: any) => [price.asset, price.price]) || []
  );

  // Calculate pool metrics using helper functions
  const totalMTokenSupply = mTokenBalance?.token?._totalSupply || "0";
  const actualUnderlying = borrowableBalance?.token?._totalSupply || "0";
  
  const exchangeRate = calculateExchangeRate(totalMTokenSupply, actualUnderlying);
  const totalUSDSTSupplied = calculateTotalUSDSTSupplied(totalMTokenSupply, exchangeRate);
  const totalBorrowed = calculateTotalBorrowed(
    userLoan || [], 
    borrowableAssetConfig?.interestRate || 0, 
    Math.floor(Date.now() / 1000)
  );
  const utilizationRate = calculateUtilizationRate(totalBorrowed, totalUSDSTSupplied);
  const totalCollateralValue = calculateTotalCollateralValue(
    assetConfigs || [], 
    allCollaterals, 
    priceMap, 
    borrowableAsset
  );
  const { supplyAPY, borrowAPY } = calculateAPYs(
    borrowableAssetConfig?.interestRate || 0,
    borrowableAssetConfig?.reserveFactor || 1000
  );

  // Calculate derived values
  const availableLiquidity = BigInt(totalUSDSTSupplied) - BigInt(totalBorrowed);
  const conversionRate = Number(exchangeRate) / Number(10n ** 18n);

  return {
    supplyable: {
      ...borrowableBalance?.token,
      userBalance: borrowableBalance?.balance?.toString() || "0",
    },
    withdrawable: {
      ...mTokenBalance?.token,
      userBalance: mTokenBalance?.balance?.toString() || "0",
      canWithdraw: BigInt(mTokenBalance?.balance || "0") > 0n,
    },
    // Pool metrics
    totalUSDSTSupplied,
    totalBorrowed,
    utilizationRate,
    availableLiquidity: availableLiquidity.toString(),
    totalCollateralValue,
    supplyAPY,
    borrowAPY,
    conversionRate,
  };
};

export const getLoan = async (
  accessToken: string,
  userAddress: string
): Promise<any> => {
  const registry = await getPool(accessToken, userAddress);
  
  // Find the user's loan from the array
  const userLoanEntry = registry.lendingPool?.userLoan?.find((loan: any) => loan.user === userAddress);
  const userLoan = userLoanEntry?.LoanInfo;

  if (!userLoan) return null;

  const currentTime = Math.floor(Date.now() / 1000);
  
  // Get user's collaterals
  const userCollaterals: CollateralInfo[] = (registry.collateralVault?.userCollaterals || [])
    .filter((c: any) => c.user === userAddress)
    .map((c: any) => ({
      asset: c.asset,
      amount: c.amount,
    }));

  // Build asset configs map from the actual mapping
  const assetConfigs = new Map<string, AssetConfig>();
  
  // Add all asset configs from the mapping
  (registry.lendingPool?.assetConfigs || []).forEach((config: any) => {
    const price = registry.oracle?.prices?.find((p: any) => p.asset === config.asset)?.price || "0";
    assetConfigs.set(config.asset, {
      interestRate: config.AssetConfig?.interestRate || 0,
      liquidationThreshold: config.AssetConfig?.liquidationThreshold || 0,
      ltv: config.AssetConfig?.ltv || 0,
      price: price,
    });
  });

  return simulateLoan(userLoan, userCollaterals, assetConfigs, currentTime);
};

export const executeLiquidation = async (
  accessToken: string,
  loanId: string,
  options: { collateralAsset?: string; repayAmount?: string | number | bigint } = {}
) => {
  const { liquidityPool } = await getPool(accessToken, undefined, { select: "liquidityPool" });
  if (!liquidityPool || typeof liquidityPool !== "string") {
    throw new Error("Liquidity pool address not found");
  }
  const liquidityPoolAddr = liquidityPool;

  // Fetch full registry to locate the loan details
  const registry = await getPool(accessToken, undefined);
  const found = (registry.lendingPool.loans || []).find((e: any) => e.key === loanId);
  if (!found) {
    throw new Error(`Loan ${loanId} not found`);
  }
  const loan = found.LoanInfo;

  // choose collateral asset: if client supplied via body use it, else first collateral
  const chosenCollateral = options.collateralAsset || (loan.collaterals?.[0]?.asset) || loan.collateralAsset;

  if (!chosenCollateral) {
    throw new Error("Unable to determine collateral asset for liquidation");
  }

  // Determine repay amount
  let repayAmount: bigint;
  if (options.repayAmount !== undefined) {
    repayAmount = toBig(options.repayAmount);
  } else {
    // Default logic: up-to-date owed amount (subject to close factor)
    const now = Math.floor(Date.now() / 1000);
    const rateArr = registry.lendingPool.interestRate || [];
    const rateObj = rateArr.find((r: any) => r.asset?.toLowerCase() === loan.asset.toLowerCase());
    const rateNum = rateObj ? Number(rateObj.rate) : 0;
    const rateScaled = Math.round(rateNum * 100);
    const durationSec = Math.max(0, now - Number(loan.lastUpdated));
    const interestAcc = (toBig(loan.amount) * BigInt(rateScaled) * BigInt(Math.floor(durationSec / 3600))) / BigInt(8760 * 100 * 100);
    const totalOwed = toBig(loan.amount) + interestAcc;

    // health factor to choose close factor
    // Build price and ratio maps from registry data
    const priceMap = new Map<string, string>();
    const ratioMap = new Map<string, any>();
    
    // Build price map from oracle data
    (registry.oracle?.prices || []).forEach((price: any) => {
      priceMap.set(price.asset, price.price);
    });
    
    // Build ratio map from asset configs
    (registry.lendingPool?.assetConfigs || []).forEach((config: any) => {
      ratioMap.set(config.asset, config.AssetConfig);
    });
    
    // Calculate health factor using total collateral value and total owed
    const totalCollateralValue = calculateTotalCollateralValueForHealth(
      loan.collaterals || [],
      new Map(Array.from(ratioMap.entries()).map(([asset, config]) => [
        asset, 
        { 
          price: priceMap.get(asset) || "0",
          liquidationThreshold: config?.liquidationThreshold || 0,
          interestRate: config?.interestRate || 0
        }
      ]))
    );
    
    const hf = calculateHealthFactor(totalCollateralValue, totalOwed.toString());
    const healthFactorPercentage = Number(hf) / Number(constants.DECIMALS);
    repayAmount = healthFactorPercentage >= 0.95 ? totalOwed / 2n : totalOwed;
  }

  const tx = buildFunctionTx([
    {
      contractName: extractContractName(Token),
      contractAddress: loan.asset,
      method: "approve",
      args: { spender: liquidityPoolAddr, value: repayAmount.toString() },
    },
    {
      contractName: extractContractName(LendingPool),
      contractAddress: constants.LendingPool,
      method: "liquidate",
      args: { loanId },
    },
  ]);

  try {
    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error: any) {
    const msg = error?.response?.data?.message || error.message || "";
    if (msg.includes("Invalid borrower")) {
      throw new Error("Self-liquidation is not allowed. Use a different account to liquidate this position.");
    }
    throw error;
  }
};

export const setInterestRate = async (
  accessToken: string,
  body: Record<string, string | number>
) => {
  if (!body.asset || body.rate === undefined) {
    throw new Error("Missing required parameters: asset and rate");
  }

  const rateValue = Number(body.rate);
  if (isNaN(rateValue) || rateValue < 0 || rateValue > 100) {
    throw new Error("Interest rate must be a number between 0 and 100");
  }

  // Get pool configurator address from lending registry
  const registry = await getPool(accessToken, undefined, { select: "_owner" });
  const poolConfiguratorAddress = registry._owner;
  
  if (!poolConfiguratorAddress) {
    throw new Error("Pool configurator address not found in lending registry");
  }

  const tx = buildFunctionTx({
    contractName: extractContractName(constants.PoolConfigurator),
    contractAddress: poolConfiguratorAddress,
    method: "setInterestRate",
    args: { 
      asset: body.asset, 
      newRate: rateValue
    },
  });

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash };
};

export const setCollateralRatio = async (
  accessToken: string,
  body: Record<string, string | number>
) => {
  if (!body.asset || body.ratio === undefined) {
    throw new Error("Missing required parameters: asset and ratio");
  }

  const ratioValue = Number(body.ratio);
  if (isNaN(ratioValue) || ratioValue < 100 || ratioValue > 1000) {
    throw new Error("Collateral ratio must be a number between 100 and 1000");
  }

  // Get pool configurator address from lending registry
  const registry = await getPool(accessToken, undefined, { select: "_owner" });
  const poolConfiguratorAddress = registry._owner;
  
  if (!poolConfiguratorAddress) {
    throw new Error("Pool configurator address not found in lending registry");
  }

  const tx = buildFunctionTx({
    contractName: extractContractName(constants.PoolConfigurator),
    contractAddress: poolConfiguratorAddress,
    method: "setCollateralRatio",
    args: { 
      asset: body.asset, 
      newRatio: ratioValue
    },
  });

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash };
};

export const setLiquidationBonus = async (
  accessToken: string,
  body: Record<string, string | number>
) => {
  if (!body.asset || body.bonus === undefined) {
    throw new Error("Missing required parameters: asset and bonus");
  }

  const bonusValue = Number(body.bonus);
  if (isNaN(bonusValue) || bonusValue < 100 || bonusValue > 200) {
    throw new Error("Liquidation bonus must be a number between 100 and 200");
  }

  // Get pool configurator address from lending registry
  const registry = await getPool(accessToken, undefined, { select: "_owner" });
  const poolConfiguratorAddress = registry._owner;
  
  if (!poolConfiguratorAddress) {
    throw new Error("Pool configurator address not found in lending registry");
  }

  const tx = buildFunctionTx({
    contractName: extractContractName(constants.PoolConfigurator),
    contractAddress: poolConfiguratorAddress,
    method: "setLiquidationBonus",
    args: { 
      asset: body.asset, 
      newBonus: bonusValue
    },
  });

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash };
};
