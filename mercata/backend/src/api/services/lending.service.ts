import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { getBalance } from "./tokens.service";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";
import { simulateLoan, CollateralInfo, AssetConfig } from "../helpers/lending.helper";

const {
  registrySelectFields,
  lendingRegistry,
  LendingPool,
  LendingRegistry,
  Token,
  CollateralVault,
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
    select: `lendingPool:lendingPool_fkey(assetConfigs:${LendingPool}-assetConfigs(asset:key),borrowableAsset),collateralVault:collateralVault_fkey(userCollaterals:${CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text))`,
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

  return assets.map((asset: string) => {
    const token = tokenMap.get(asset) as any;
    const collateral = collateralMap.get(asset) as any;

    return {
      address: asset,
      ...token?.token,
      userBalance: token?.balance?.toString() || "0",
      collateralizedAmount: collateral?.amount || "0",
      isCollateralized: collateral?.amount > 0,
      canSupply: BigInt(token?.balance || "0") > 0n,
    };
  });
};

export const liquidityAndBalance = async (
  accessToken: string,
  userAddress: string,
) => {
  const registry = await getPool(accessToken, undefined, { 
    select: `lendingPool:lendingPool_fkey(borrowableAsset,mToken)`
  });
  
  const { borrowableAsset, mToken } = registry.lendingPool || {};
  if (!borrowableAsset || !mToken) {
    throw new Error("Lending pool, borrowable asset, or mToken not found");
  }

  const balances = await Promise.all([
    getBalance(accessToken, userAddress, { 
      address: `eq.${borrowableAsset}`,
      select: `address,user:key,balance:value::text,token:${Token}(_name,_symbol,_owner,_totalSupply::text,customDecimals)`
    }),
    getBalance(accessToken, userAddress, { 
      address: `eq.${mToken}`,
      select: `address,user:key,balance:value::text,token:${Token}(_name,_symbol,_owner,_totalSupply::text,customDecimals)`
    })
  ]);

  const [borrowableBalance, mTokenBalance] = balances.map(b => b[0]);
  const mTokenAmount = BigInt(mTokenBalance?.balance || "0");

  return {
    supplyable: {
      ...borrowableBalance?.token,
      userBalance: borrowableBalance?.balance?.toString() || "0",
    },
    withdrawable: {
      ...mTokenBalance?.token,
      userBalance: mTokenBalance?.balance?.toString() || "0",
      canWithdraw: mTokenAmount > 0n,
    }
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
      price: price,
    });
  });

  return simulateLoan(userLoan, userCollaterals, assetConfigs, currentTime);
};

export const executeLiquidation = async (
  accessToken: string,
  loanId: string  
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

  // Approve the LiquidityPool to pull up to the full outstanding amount.
  const maxApprove = (BigInt(loan.amount) * 2n).toString();

  const tx = buildFunctionTx([
    {
      // First approve the debt token so LiquidityPool can pull repayment
      contractName: extractContractName(Token),
      contractAddress: loan.asset,
      method: "approve",
      args: { spender: liquidityPoolAddr, value: maxApprove },
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

  const tx = buildFunctionTx({
    contractName: extractContractName(constants.PoolConfigurator),
    contractAddress: constants.PoolConfigurator,
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

  const tx = buildFunctionTx({
    contractName: extractContractName(constants.PoolConfigurator),
    contractAddress: constants.PoolConfigurator,
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

  const tx = buildFunctionTx({
    contractName: extractContractName(constants.PoolConfigurator),
    contractAddress: constants.PoolConfigurator,
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
