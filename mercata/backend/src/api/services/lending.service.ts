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
  calculateExchangeRate,
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
          ...(userAddress
            ? {
                "lendingPool.userLoan.key": `eq.${userAddress}`,
                "collateralVault.userCollaterals.key": `eq.${userAddress}`,
              }
            : {}),
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
  // Fetch pool data with optimized query
  const registry = await getPool(accessToken, undefined);
  
  const { borrowableAsset, mToken, assetConfigs, userLoan, totalBorrowPrincipal } = registry.lendingPool || {};
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

  // Extract user balance from token metadata
  const borrowableBalance = borrowableToken?.balances?.find((b: any) => b.user === userAddress)?.balance || "0";
  const mTokenBalance = mTokenInfo?.balances?.find((b: any) => b.user === userAddress)?.balance || "0";

  // Extract total supply values with fallbacks
  const totalMTokenSupply = mTokenInfo?._totalSupply || "0";
  const availableLiquidity = borrowableToken?.balances?.find((b: any) => b.user === registry.liquidityPool?.address)?.balance || "0";
  // Get borrowable asset config
  const borrowableAssetConfig = assetConfigs?.find((config: any) => config.asset === borrowableAsset)?.AssetConfig;

  // Build price map from oracle data
  const priceMap = new Map<string, string>();
  
  // Add prices from oracle data
  (registry.oracle?.prices || []).forEach((price: any) => {
    priceMap.set(price.asset, price.price);
  });
  
  // Add fallback prices for borrowable asset and mToken from token data
  if (!priceMap.has(borrowableAsset)) {
    priceMap.set(borrowableAsset, borrowableToken?.price?.toString() || "0");
  }
  if (!priceMap.has(mToken)) {
    priceMap.set(mToken, mTokenInfo?.price?.toString() || "0");
  }

  // Calculate all pool metrics in parallel
  const currentTime = Math.floor(Date.now() / 1000);
  const totalUSDSTSupplied = (toBig(availableLiquidity) + toBig(totalBorrowPrincipal)).toString();
  
  const [
    exchangeRate,
    totalBorrowed,
    totalCollateralValue,
    apyData
  ] = await Promise.all([
    Promise.resolve(calculateExchangeRate(totalMTokenSupply, totalUSDSTSupplied)),
    Promise.resolve(calculateTotalBorrowed(
      userLoan || [], 
      borrowableAssetConfig?.interestRate || 0, 
      currentTime
    )),
    Promise.resolve(calculateTotalCollateralValue(
      assetConfigs || [], 
      allCollaterals, 
      priceMap, 
      borrowableAsset
    )),
    Promise.resolve(calculateAPYs(
      borrowableAssetConfig?.interestRate || 0,
      borrowableAssetConfig?.reserveFactor || 1000
    ))
  ]);

  // Calculate derived metrics
  const utilizationRate = calculateUtilizationRate(totalBorrowed, totalUSDSTSupplied);

  // Calculate max withdrawable amount considering both user's mUSDST balance and pool's available liquidity
  const userMTokenBalance = BigInt(mTokenBalance);
  const userUSDSTValue = userMTokenBalance > 0n 
    ? ((userMTokenBalance * BigInt(exchangeRate)) / (10n ** 18n))
    : 0n;
  
  // Pool's available liquidity (cash in the pool)
  const poolAvailableLiquidity = BigInt(availableLiquidity);
  
  // Max withdrawable is the minimum of user's USDST value and pool's available liquidity
  const maxWithdrawableUSDST = userUSDSTValue < poolAvailableLiquidity 
    ? userUSDSTValue.toString()
    : poolAvailableLiquidity.toString();

  // Destructure token data to exclude balances array
  const { balances: _, ...borrowableTokenClean } = borrowableToken || {};
  const { balances: __, ...mTokenInfoClean } = mTokenInfo || {};

  return {
    supplyable: {
      ...borrowableTokenClean,
      userBalance: borrowableBalance,
    },
    withdrawable: {
      ...mTokenInfoClean,
      userBalance: mTokenBalance,
      maxWithdrawableUSDST,
    },
    // Pool metrics
    totalUSDSTSupplied,
    totalBorrowed,
    utilizationRate,
    availableLiquidity,
    totalCollateralValue,
    supplyAPY: apyData.supplyAPY,
    borrowAPY: apyData.borrowAPY,
    exchangeRate,
  };
};

export const getLoan = async (
  accessToken: string,
  userAddress: string | undefined
): Promise<any> => {
  // If userAddress is undefined, get all data without filtering by user
  const registry = await getPool(
    accessToken, 
    userAddress, 
    userAddress ? {} : { select: registrySelectFields.join(",") }
  );
  
  const currentTime = Math.floor(Date.now() / 1000);
  
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

  // If userAddress is provided, return loan for specific user
  if (userAddress) {
    // Find the user's loan from the array
    const userLoanEntry = registry.lendingPool?.userLoan?.find((loan: any) => loan.user === userAddress);
    const userLoan = userLoanEntry?.LoanInfo;

    // Get user's collaterals
    const userCollaterals: CollateralInfo[] = (registry.collateralVault?.userCollaterals || [])
      .filter((c: any) => c.user === userAddress)
      .map((c: any) => ({
        asset: c.asset,
        amount: c.amount,
      }));

    return simulateLoan(userLoan, userCollaterals, assetConfigs, currentTime);
  }

  // If userAddress is undefined, return simulated loans for all users
  const allLoans: any[] = [];
  
  // Get all user loans
  const allUserLoans = registry.lendingPool?.userLoan || [];
  
  for (const loanEntry of allUserLoans) {
    const userLoan = loanEntry.LoanInfo;
    const userAddr = loanEntry.user;
    
    if (!userLoan || !userAddr) continue;

    // Get user's collaterals
    const userCollaterals: CollateralInfo[] = (registry.collateralVault?.userCollaterals || [])
      .filter((c: any) => c.user === userAddr)
      .map((c: any) => ({
        asset: c.asset,
        amount: c.amount,
      }));

    // Simulate loan for this user
    const simulatedLoan = simulateLoan(userLoan, userCollaterals, assetConfigs, currentTime);
    
    // Add user address to the result
    allLoans.push({
      user: userAddr,
      ...simulatedLoan,
    });
  }

  return allLoans;
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

  // Fetch full registry for the borrower only
  const registry = await getPool(accessToken, loanId);
  const userLoanData = registry.lendingPool?.userLoan?.[0];
  if (!userLoanData || !userLoanData.LoanInfo) {
    throw new Error(`Loan ${loanId} not found`);
  }
  const loan = userLoanData.LoanInfo;

  // User's collaterals from CollateralVault mapping
  const userCollaterals = (registry.collateralVault?.userCollaterals || []).map((c: any) => ({ asset: c.asset, amount: c.amount }));
 
  // choose collateral asset: if client supplied via body use it, else first collateral
  const chosenCollateral = options.collateralAsset || userCollaterals[0]?.asset;

  if (!chosenCollateral) {
    throw new Error("Unable to determine collateral asset for liquidation");
  }

  // Determine repay amount
  let repayAmount: bigint;
  if (options.repayAmount !== undefined) {
    repayAmount = toBig(options.repayAmount);
  } else {
    // --- Calculate total owed (principal + stored interest) ---
    const totalOwed = toBig(loan.principalBalance) + toBig(loan.interestOwed || 0);

    // Determine close-factor debt limit (100 % or 50 %) based on latest health factor
    const priceMap = new Map<string, string>();
    (registry.oracle?.prices || []).forEach((p: any) => priceMap.set(p.asset, p.price));

    const ratioMap = new Map<string, any>();
    (registry.lendingPool?.assetConfigs || []).forEach((cfg: any) => ratioMap.set(cfg.asset, cfg.AssetConfig));

    const totalCollateralValue = calculateTotalCollateralValueForHealth(
      userCollaterals,
      new Map(Array.from(ratioMap.entries()).map(([asset, cfg]) => [
        asset,
        { price: priceMap.get(asset) || "0", liquidationThreshold: cfg?.liquidationThreshold || 0, interestRate: cfg?.interestRate || 0 }
      ]))
    );

    const hf = calculateHealthFactor(totalCollateralValue, totalOwed.toString());
    const hfPct = Number(toBig(hf)) / Number(constants.DECIMALS);
    const debtLimit = hfPct <= 0.95 ? totalOwed : totalOwed / 2n;

    // --- Ceil-based collateral limit to eliminate dust ---
    const priceDebt = toBig(priceMap.get(registry.lendingPool?.borrowableAsset) || "0");
    const priceColl = toBig(priceMap.get(chosenCollateral) || "0");
    const collateralAmt = toBig((userCollaterals.find((c: any) => c.asset === chosenCollateral) as any)?.amount || "0");
    const liqBonus = BigInt((registry.lendingPool?.assetConfigs || []).find((c:any)=>c.asset===chosenCollateral)?.AssetConfig?.liquidationBonus || 10500);

    let ceilCollateralCover = debtLimit; // default
    if (priceDebt > 0n && priceColl > 0n) {
      const num = collateralAmt * priceColl * 10000n;
      const den = priceDebt * liqBonus;
      ceilCollateralCover = (num + den - 1n) / den; // ceil division
    }

    repayAmount = ceilCollateralCover <= debtLimit ? ceilCollateralCover : debtLimit;
  }

  const tx = buildFunctionTx([
    {
      contractName: extractContractName(Token),
      contractAddress: registry.lendingPool?.borrowableAsset || loan.asset,
      method: "approve",
      args: { spender: liquidityPoolAddr, value: repayAmount.toString() },
    },
    {
      contractName: extractContractName(LendingPool),
      contractAddress: registry.lendingPool?.address,
      method: "liquidationCall",
      args: { collateralAsset: chosenCollateral, borrower: loanId, debtToCover: repayAmount.toString() },
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


export const configureAsset = async (
  accessToken: string,
  body: Record<string, string | number>
) => {
  // Validate required parameters
  if (!body.asset || body.ltv === undefined || body.liquidationThreshold === undefined || 
      body.liquidationBonus === undefined || body.interestRate === undefined || 
      body.reserveFactor === undefined) {
    throw new Error("Missing required parameters: asset, ltv, liquidationThreshold, liquidationBonus, interestRate, reserveFactor");
  }

  // Convert and validate parameters
  const ltv = Number(body.ltv);
  const liquidationThreshold = Number(body.liquidationThreshold);
  const liquidationBonus = Number(body.liquidationBonus);
  const interestRate = Number(body.interestRate);
  const reserveFactor = Number(body.reserveFactor);

  // Validate ranges (values should be in basis points)
  if (isNaN(ltv) || ltv < 100 || ltv > 9500) {
    throw new Error("LTV must be between 100 and 9500 basis points (1% to 95%)");
  }
  if (isNaN(liquidationThreshold) || liquidationThreshold < 100 || liquidationThreshold > 9500) {
    throw new Error("Liquidation threshold must be between 100 and 9500 basis points (1% to 95%)");
  }
  if (isNaN(liquidationBonus) || liquidationBonus < 10000 || liquidationBonus > 12500) {
    throw new Error("Liquidation bonus must be between 10000 and 12500 basis points (100% to 125%)");
  }
  if (isNaN(interestRate) || interestRate < 0 || interestRate > 10000) {
    throw new Error("Interest rate must be between 0 and 10000 basis points (0% to 100%)");
  }
  if (isNaN(reserveFactor) || reserveFactor < 0 || reserveFactor > 5000) {
    throw new Error("Reserve factor must be between 0 and 5000 basis points (0% to 50%)");
  }

  // Validate relationships
  if (ltv > liquidationThreshold) {
    throw new Error("LTV cannot be higher than liquidation threshold");
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
    method: "configureAsset",
    args: {
      asset: body.asset,
      ltv: ltv,
      liquidationThreshold: liquidationThreshold,
      liquidationBonus: liquidationBonus,
      interestRate: interestRate,
      reserveFactor: reserveFactor,
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
  id: string; // unique loan id (same as map key from Cirrus)
  user: string;
  asset: string;
  assetSymbol?: string;
  amount: string; // total debt (principal + interest)
  healthFactor: number; // as percentage 1.0 == 100%
  collaterals: LiquidationCollateralInfo[];
  maxRepay?: string; // maximum amount that can be repaid
}

/**
 * Fetch all loans and calculate health factors so the UI can display liquidatable positions.
 * If margin is provided (>0), this returns loans whose HF is between 1 and 1+margin.
 * If margin is undefined, returns loans with HF < 1 (i.e. can be liquidated right now).
 */
export const listLoansForLiquidation = async (
  accessToken: string,
  margin?: number
): Promise<LiquidationEntry[]> => {
  // Build an expanded select so we get ALL loans / collaterals in one shot
  const select =
    `lendingPool:lendingPool_fkey(` +
      `address,` +
      `borrowableAsset,` +
      `assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value),` +
      /* alias the existing userLoan mapping as "loans" so we can iterate over all */
      `loans:${LendingPool}-userLoan(user:key,LoanInfo:value)` +
    `),` +
    `collateralVault:collateralVault_fkey(userCollaterals:${CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text)),` +
    `oracle:priceOracle_fkey(prices:${PriceOracle}-prices(asset:key,price:value::text))`;

  const registry = await getPool(accessToken, undefined, { select });

  const borrowableAsset: string = registry.lendingPool?.borrowableAsset;
  const assetConfigsArr = registry.lendingPool?.assetConfigs || [];
  const loansArr = registry.lendingPool?.loans || [];
  const collateralsArr = registry.collateralVault?.userCollaterals || [];
  const pricesArr = registry.oracle?.prices || [];

  // Build helper maps
  const priceMap = new Map<string, string>(pricesArr.map((p: any) => [p.asset, p.price]));
  
  // Build asset config map
  const assetConfigMap = new Map<string, any>();
  assetConfigsArr.forEach((cfg: any) => {
    assetConfigMap.set(cfg.asset, cfg.AssetConfig);
  });
  
  // Group collaterals by user for quick lookup
  const collMap = new Map<string, CollateralInfo[]>();
  for (const c of collateralsArr) {
    const list = collMap.get(c.user) || [];
    list.push({ asset: c.asset, amount: c.amount });
    collMap.set(c.user, list);
  }

  const currentTime = Math.floor(Date.now() / 1000);

  // Collect unique token addresses for symbol lookup (borrow asset + all collaterals)
  const tokenSet = new Set<string>([borrowableAsset]);
  collateralsArr.forEach((c: any) => tokenSet.add(c.asset));
  const tokenAddrList = Array.from(tokenSet);
  let tokenInfoMap = new Map<string, any>();
  try {
    const tokenRows = await getTokens(accessToken, { address: `in.(${tokenAddrList.join(',')})`, select: "address,_symbol,_name" });
    tokenInfoMap = new Map<string, any>(tokenRows.map((t: any) => [t.address, t]));
  } catch {
    // swallow – symbols are optional
  }

  const results: LiquidationEntry[] = [];

  for (const entry of loansArr) {
    const userAddr: string = entry.key || entry.user; // The key in the mapping IS the user address
    const loan = entry.LoanInfo;
    if (!loan) continue;

    // Build assetConfigs map with price for simulateLoan helper
    const acMap = new Map<string, AssetConfig>();
    assetConfigsArr.forEach((cfg: any) => {
      const p = priceMap.get(cfg.asset) || "0";
      acMap.set(cfg.asset, {
        interestRate: cfg.AssetConfig?.interestRate || 0,
        liquidationThreshold: cfg.AssetConfig?.liquidationThreshold || 0,
        ltv: cfg.AssetConfig?.ltv || 0,
        price: p,
      });
    });

    const userColls = collMap.get(userAddr) || [];
    const sim = simulateLoan(loan, userColls, acMap, currentTime);
    const hf = sim.healthFactor; // already percentage (e.g. 0.85)

    const include = margin === undefined ? hf < 1 : hf >= 1 && hf < 1 + margin;
    if (!include) continue;

    // Calculate total owed amount with interest
    const totalOwed = toBig(sim.totalAmountOwed);
    
    // Determine close factor based on health factor
    // HF <= 0.95: 100% liquidation allowed (position is in danger)
    // 0.95 < HF < 1: 50% liquidation allowed (position is less risky)
    const closeFactor = hf <= 0.95 ? 1.0 : 0.5;
    const debtLimit = (totalOwed * BigInt(Math.floor(closeFactor * 1e18))) / constants.DECIMALS;

    // Prepare collateral display info
    const collateralDisplay: LiquidationCollateralInfo[] = userColls.map((col) => {
      const price = priceMap.get(col.asset) || "0";
      const collateralValueWei = (toBig(col.amount) * toBig(price)) / constants.DECIMALS;
      const usdVal = collateralValueWei.toString();
      const tokenInfo = tokenInfoMap.get(col.asset);
      
      // Get liquidation bonus from asset config (default 5% = 10500 basis points)
      const assetConfig = assetConfigMap.get(col.asset);
      const liquidationBonus = assetConfig?.liquidationBonus || 10500;
      
      // Calculate collateral-specific limit: how much debt can be repaid with this collateral
      // Contract formula rearranged:
      // maxDebtToCover = (collateralAmount * priceCollateral * 10000) / (priceDebt * liquidationBonus)
      const priceDebtStr = priceMap.get(borrowableAsset) || "0";
      const priceDebt = toBig(priceDebtStr);
      const priceCollBig = toBig(price);
      const collateralAmtBig = toBig(col.amount);
      let collateralLimit = 0n;
      if (priceDebt > 0n && priceCollBig > 0n) {
        collateralLimit = (collateralAmtBig * priceCollBig * 10000n) / (priceDebt * BigInt(liquidationBonus));
      }
       
      // The actual max repay is the minimum of debt limit and collateral limit
      const effectiveMaxRepay = debtLimit < collateralLimit ? debtLimit : collateralLimit;
      
      // Calculate expected profit: (liquidation_bonus - 1) × effective_max_repay
      const profitFactor = BigInt(liquidationBonus - 10000); // e.g., 500 for 5% bonus
      const expectedProfit = (effectiveMaxRepay * profitFactor) / 10000n;
      
      return {
        asset: col.asset,
        symbol: tokenInfo?._symbol || tokenInfo?._name,
        amount: col.amount,
        usdValue: usdVal,
        expectedProfit: expectedProfit.toString(),
        maxRepay: effectiveMaxRepay.toString(),
        liquidationBonus: liquidationBonus,
      };
    });

    const tokenBorrowInfo = tokenInfoMap.get(borrowableAsset);

    results.push({
      id: userAddr, // Use user address as unique ID since each user has only one loan
      user: userAddr,
      asset: borrowableAsset,
      assetSymbol: tokenBorrowInfo?._symbol || tokenBorrowInfo?._name,
      amount: (toBig(loan.principalBalance) + toBig(loan.interestOwed || "0")).toString(),
      healthFactor: hf,
      collaterals: collateralDisplay,
      maxRepay: debtLimit.toString(), // Add to loan level as well
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
