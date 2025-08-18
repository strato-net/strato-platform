import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { getBalance, getTokens } from "./tokens.service";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";
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
  exchangeRateFromComponents,
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

/**
 * Generic Cirrus fetch for the LendingRegistry row.
 * - No implicit user filters here. Callers pass explicit filters/selects when needed.
 */
export const getPool = async (
  accessToken: string,
  _userAddress: string | undefined,
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
    select:
      `lendingPool:lendingPool_fkey(` +
        `assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value),` +
        `borrowableAsset` +
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
        canSupply: toBig(userBalance) > 0n,
        maxBorrowingPower,
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
  // Fetch pool data with explicit select (index fields + userLoan + prices)
  const registry = await getPool(accessToken, undefined, {
    select:
      `lendingPool:lendingPool_fkey(` +
        `address,borrowableAsset,mToken,` +
        `borrowIndex::text,totalScaledDebt::text,reservesAccrued::text,lastAccrual::text,` +
        `assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value),` +
        `userLoan:${LendingPool}-userLoan(user:key,LoanInfo:value)` +
      `),` +
      `collateralVault:collateralVault_fkey(` +
        `userCollaterals:${CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text)` +
      `),` +
      `oracle:priceOracle_fkey(address,` +
        `prices:${PriceOracle}-prices(asset:key,price:value::text)` +
      `),` +
      `liquidityPool:liquidityPool_fkey(address)`,
    "lendingPool.userLoan.key": `eq.${userAddress}`,
  });

  const { borrowableAsset, mToken, assetConfigs } = registry.lendingPool || {};
  const allCollaterals = registry.collateralVault?.userCollaterals || [];

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

  // System totals and exchange rate
  const systemTotalDebt = totalDebtFromScaled(totalScaledDebtStr.toString(), borrowIndexStr.toString());

  const exchangeRate = exchangeRateFromComponents(
    availableLiquidity,
    systemTotalDebt,
    reservesAccruedStr.toString(),
    totalMTokenSupply
  );

  const totalUSDSTSupplied = (toBig(availableLiquidity) + toBig(systemTotalDebt)).toString();

  // Utilization rate: U = debt / (cash + debt − reserves)
  let denom = toBig(availableLiquidity) + toBig(systemTotalDebt);
  denom = toBig(reservesAccruedStr || "0") < denom ? (denom - toBig(reservesAccruedStr || "0")) : toBig(availableLiquidity);
  const utilizationRate = denom === 0n ? 0 : Number((toBig(systemTotalDebt) * 10000n) / denom) / 100;

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

  // User’s withdrawable underlying (min of user mToken value and pool cash)
  const userMTokenBalance = toBig(mTokenBalance);
  const userUSDSTValue = userMTokenBalance > 0n 
    ? ((userMTokenBalance * toBig(exchangeRate)) / (10n ** 18n))
    : 0n;

  const poolAvailableLiquidity = toBig(availableLiquidity);
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
      userBalance: mTokenBalance,
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
    totalAmountOwed,
    totalAmountOwedPreview,
    // Compat:
    totalBorrowPrincipal,
  };
};

export const getLoan = async (
  accessToken: string,
  userAddress: string | undefined
): Promise<any> => {
  // Fetch registry; explicit select with borrowIndex so simulateLoan can compute debt
  const registry = await getPool(accessToken, undefined, {
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

    return simulateLoan(userLoan || null, userCollaterals, assetConfigs, borrowIndex);
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

    const simulatedLoan = simulateLoan(userLoan || null, userCollaterals, assetConfigs, borrowIndex);
    allLoans.push({ user: userAddr, ...simulatedLoan });
  }

  return allLoans;
};

export const executeLiquidation = async (
  accessToken: string,
  loanId: string,
  options: { collateralAsset?: string; repayAmount?: string | number | bigint } = {}
) => {
  // LiquidityPool address
  const { liquidityPool } = await getPool(accessToken, undefined, { select: "liquidityPool" });
  if (!liquidityPool || typeof liquidityPool !== "string") {
    throw new Error("Liquidity pool address not found");
  }
  const liquidityPoolAddr = liquidityPool;

  // Borrower-specific data
  const registry = await getPool(accessToken, undefined, {
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
  if (options.repayAmount !== undefined) {
    repayAmount = toBig(options.repayAmount);
  } else {
    // Index-based total owed
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
    const liqBonus = toBig(
      assetConfigMap.get(chosenCollateral)?.liquidationBonus ?? 10500
    );

    let ceilCollateralCover = debtLimit;
    if (priceDebt > 0n && priceColl > 0n) {
      const num = collateralAmt * priceColl * 10000n;
      const den = priceDebt * liqBonus;
      ceilCollateralCover = (num + den - 1n) / den;
    }

    repayAmount = ceilCollateralCover <= debtLimit ? ceilCollateralCover : debtLimit;
  }

  const tx = buildFunctionTx([
    {
      contractName: extractContractName(Token),
      contractAddress: borrowableAsset,
      method: "approve",
      args: { spender: liquidityPoolAddr, value: repayAmount.toString() },
    },
    {
      contractName: extractContractName(LendingPool),
      contractAddress: registry.lendingPool?.address,
      method: "liquidationCall",
      args: {
        collateralAsset: options.collateralAsset || userCollaterals[0]?.asset,
        borrower: loanId,
        debtToCover: repayAmount.toString(),
      },
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
      throw new Error(
        "Self-liquidation is not allowed. Use a different account to liquidate this position."
      );
    }
    throw error;
  }
};

export const configureAsset = async (
  accessToken: string,
  body: Record<string, string | number>
) => {
  if (!body.asset || body.ltv === undefined || body.liquidationThreshold === undefined || 
      body.liquidationBonus === undefined || body.interestRate === undefined || 
      body.reserveFactor === undefined) {
    throw new Error("Missing required parameters: asset, ltv, liquidationThreshold, liquidationBonus, interestRate, reserveFactor");
  }

  const ltv = Number(body.ltv);
  const liquidationThreshold = Number(body.liquidationThreshold);
  const liquidationBonus = Number(body.liquidationBonus);
  const interestRate = Number(body.interestRate);
  const reserveFactor = Number(body.reserveFactor);

  if (isNaN(ltv) || ltv < 100 || ltv > 9500) throw new Error("LTV must be between 100 and 9500 basis points (1% to 95%)");
  if (isNaN(liquidationThreshold) || liquidationThreshold < 100 || liquidationThreshold > 9500) throw new Error("Liquidation threshold must be between 100 and 9500 basis points (1% to 95%)");
  if (isNaN(liquidationBonus) || liquidationBonus < 10000 || liquidationBonus > 12500) throw new Error("Liquidation bonus must be between 10000 and 12500 basis points (100% to 125%)");
  if (isNaN(interestRate) || interestRate < 0 || interestRate > 10000) throw new Error("Interest rate must be between 0 and 10000 basis points (0% to 100%)");
  if (isNaN(reserveFactor) || reserveFactor < 0 || reserveFactor > 5000) throw new Error("Reserve factor must be between 0 and 5000 basis points (0% to 50%)");
  if (ltv > liquidationThreshold) throw new Error("LTV cannot be higher than liquidation threshold");

  const registry = await getPool(accessToken, undefined, { select: "_owner" });
  const poolConfiguratorAddress = registry._owner;
  if (!poolConfiguratorAddress) throw new Error("Pool configurator address not found in lending registry");

  const tx = buildFunctionTx({
    contractName: extractContractName(constants.PoolConfigurator),
    contractAddress: poolConfiguratorAddress,
    method: "configureAsset",
    args: {
      asset: body.asset,
      ltv,
      liquidationThreshold,
      liquidationBonus,
      interestRate,
      reserveFactor,
    },
  });

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
      `assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value),` +
      `loans:${LendingPool}-userLoan(user:key,LoanInfo:value)` +
    `),` +
    `collateralVault:collateralVault_fkey(` +
      `userCollaterals:${CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text)` +
    `),` +
    `oracle:priceOracle_fkey(` +
      `prices:${PriceOracle}-prices(asset:key,price:value::text)` +
    `)`;

  const registry = await getPool(accessToken, undefined, { select });

  const borrowableAsset: string = registry.lendingPool?.borrowableAsset;
  const borrowIndexStr = registry.lendingPool?.borrowIndex || "0";
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
          (priceDebt * toBig(liquidationBonus));
      }

      const effectiveMaxRepay = debtLimit < collateralLimit ? debtLimit : collateralLimit;
      const profitFactor = toBig(liquidationBonus) - 10000n;
      const expectedProfit = (effectiveMaxRepay * profitFactor) / 10000n;

      return {
        asset: col.asset,
        symbol: tokenInfo?._symbol || tokenInfo?._name,
        amount: col.amount,
        usdValue: collateralValueWei.toString(),
        expectedProfit: expectedProfit.toString(),
        maxRepay: effectiveMaxRepay.toString(),
        liquidationBonus,
      };
    });

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