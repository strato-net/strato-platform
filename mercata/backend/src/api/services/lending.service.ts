import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { getBalance, getTokens } from "./tokens.service";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";

const {
  registrySelectFields,
  lendingPool,
  LendingPool,
  LendingRegistry,
  PriceOracle,
  Token,
} = constants;

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
    ...(select
      ? {}
      : {
          "lendingPool.loans.value->>active": "eq.true",
          "collateralVault.collaterals.value->>amount": "gt.0",
          "liquidityPool.deposited.value->>amount": "gt.0",
          "liquidityPool.borrowed.value->>amount": "gt.0",
        }),
    lendingPool: `eq.${lendingPool}`,
  };

  // DEBUG: log the exact query params being sent to Cirrus (no secrets exposed)
  console.log("[LendingService.getPool] Querying Cirrus", {
    endpoint: `/${LendingRegistry}`,
    params,
  });

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
  body: Record<string, string | undefined>
) => {
  try {
    const { liquidityPool } = await getPool(accessToken, { select: "liquidityPool" });
    if (!liquidityPool) {
      throw new Error("Liquidity pool address not found");
    }

    const tx: FunctionInput[] = [
      {
        contractName: extractContractName(Token),
        contractAddress: body.asset || "",
        method: "approve",
        args: {
          spender: liquidityPool,
          value: body.amount || "",
        },
      },
      {
        contractName: extractContractName(LendingPool),
        contractAddress: constants.lendingPool,
        method: "depositLiquidity",
        args: {
          asset: body.asset,
          amount: body.amount,
        },
      }
    ];

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx(tx))
    );

    return { status, hash };
  } catch (error) {
    console.error("Error depositing liquidity:", error);
    throw error;
  }
};

export const withdrawLiquidity = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx: FunctionInput[] = [{
      contractName: extractContractName(LendingPool),
      contractAddress: constants.lendingPool,
      method: "withdrawLiquidity",
      args: {
        asset: body.asset,
        amount: body.amount,
      },
    }];

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx(tx))
    );

    return { status, hash };
  } catch (error) {
    console.error("Error withdrawing liquidity:", error);
    throw error;
  }
};

export const borrow = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const lendingPool = await getPool(accessToken, {
      select: "collateralVault",
    });

    if (!lendingPool.collateralVault) {
      throw new Error("Collateral vault address not found");
    }

    const tx = buildFunctionTx([
      {
        contractName: extractContractName(Token),
        contractAddress: body.collateralAsset || "",
        method: "approve",
        args: { spender: lendingPool.collateralVault, value: body.collateralAmount || "" },
      },
      {
        contractName: extractContractName(LendingPool),
        contractAddress: constants.lendingPool,
        method: "borrow",
        args: {
          asset: body.asset,
          amount: body.amount,
          collateralAsset: body.collateralAsset,
          collateralAmount: body.collateralAmount,
        },
      }
    ]);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error) {
    console.error("Error getting loan:", error);
    throw error;
  }
};

export const repay = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    // Fetch liquidityPool address quickly (avoid heavy nested select)
    const poolMeta = await getPool(accessToken, { select: "liquidityPool" });

    // Separate full fetch to access loans & rate maps
    const lendingPoolInfo = await getPool(accessToken);

    if (!poolMeta?.liquidityPool) {
      throw new Error("Liquidity pool address not found");
    }

    const loanEntry = (lendingPoolInfo.lendingPool.loans || []).find(
      (e: any) => e.key === body.loanId
    );
    if (!loanEntry) {
      throw new Error(`Loan ${body.loanId} not found`);
    }
    const loan = loanEntry.LoanInfo;

    // Calculate up-to-date interest so we can determine the exact outstanding.
    const now = Math.floor(Date.now() / 1000);
    // interestRate is stored as array of {asset, rate}
    const rateArray = lendingPoolInfo.lendingPool.interestRate || [];
    const rateObj = rateArray.find((r: any) => r.asset?.toLowerCase() === loan.asset.toLowerCase());
    const rate = rateObj ? Number(rateObj.rate) : 0; // annualised %
    const duration = Math.max(0, now - Number(loan.lastUpdated));
    const bufferSeconds = 600; // 10-min safety buffer so tx fully closes the loan
    const interest =
      (BigInt(loan.amount) * BigInt(rate) * BigInt(duration + bufferSeconds)) /
      BigInt(365 * 24 * 60 * 100);
    const totalOwed = (BigInt(loan.amount) + interest).toString();

    // Use caller-supplied amount if it equals/exceeds total owed; otherwise bump to full repay.
    let repayAmount = body.amount || totalOwed;
    if (BigInt(repayAmount) < BigInt(totalOwed)) {
      repayAmount = totalOwed;
    }

    const tx = buildFunctionTx([
      {
        contractName: extractContractName(Token),
        contractAddress: body.asset || loan.asset,
        method: "approve",
        args: {
          spender: poolMeta.liquidityPool,
          value: repayAmount,
        },
      },
      {
        contractName: extractContractName(LendingPool),
        contractAddress: constants.lendingPool,
        method: "repayLoan",
        args: {
          loanId: body.loanId,
          amount: repayAmount,
        },
      },
    ]);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error) {
    console.error("Error repaying loan:", error);
    throw error;
  }
};

export const getDepositableTokens = async (
  accessToken: string,
  address: string
) => {
  const [registry, userTokens] = await Promise.all([
    getPool(accessToken),
    getBalance(accessToken, address),
  ]);

  const userTokenMap = new Map(userTokens.map((t: any) => [t.address, t]));
  const oraclePriceMap = new Map(
    (registry.oracle.prices || []).map(
      ({ asset, price }: { asset: string; price: string }) => [asset, price]
    )
  );
  const interestRateMap = new Map(
    (registry.lendingPool.interestRate || []).map(
      ({ asset, rate }: { asset: string; rate: number }) => [asset, rate]
    )
  );
  const liquidityMap = new Map(
    (registry.liquidityPool.totalLiquidity || []).map(
      ({ asset, amount }: { asset: string; amount: string }) => [asset, amount]
    )
  );
  return (registry.lendingPool.collateralRatio || [])
    .filter(
      ({ asset }: any) =>
        oraclePriceMap.has(asset) !== undefined && userTokenMap.has(asset)
    )
    .map(({ asset, ratio }: { asset: string; ratio: number }) => {
      const userToken = userTokenMap.get(asset) as any;
      return {
        address: asset,
        _name: userToken?.token?._name || "",
        _symbol: userToken?.token?._symbol || "",
        value: userToken?.balance?.toString() || "0",
        collateralRatio: ratio || 0,
        interestRate: interestRateMap.get(asset) || 0,
        price: oraclePriceMap.get(asset) || "0",
        liquidity: liquidityMap.get(asset) || "0",
      };
    });
};

export const getWithdrawableTokens = async (
  accessToken: string,
  address: string
): Promise<
  { address: string; _name: string; _symbol: string; value: string }[]
> => {
  const registry = await getPool(accessToken);

  const userDeposits = Object.values(registry.liquidityPool?.deposited || {})
    .map((entry: any) => entry.Deposit)
    .filter((d: any) => d.user === address) as {
    asset: string;
    amount: string;
    user: string;
  }[];

  if (!userDeposits.length) return [];

  const tokenMetadata = await getTokens(accessToken, {
    address: `in.(${userDeposits.map((d) => d.asset).join(",")})`,
  });

  const tokenMap = new Map(tokenMetadata.map((t: any) => [t.address, t]));

  return userDeposits
    .filter((d) => tokenMap.has(d.asset))
    .map((d) => {
      const token = tokenMap.get(d.asset) as any;
      return {
        address: d.asset,
        _name: token?._name || "",
        _symbol: token?._symbol || "",
        value: d.amount || "0",
      };
    });
};

export const getLoans = async (
  accessToken: string,
  address: string
): Promise<{ key: string; loan: any }[]> => {
  const registry = await getPool(accessToken);

  // Filter user-specific loans
  const userLoans = (registry.lendingPool.loans || []).filter(
    (entry: any) => entry.LoanInfo.user.toLowerCase() === address.toLowerCase()
  );

  const combinedLoans = userLoans;

  if (!combinedLoans.length) return [];

  // Collect all unique token addresses used in loans
  const tokenAddresses = [
    ...new Set(
      combinedLoans.flatMap((entry: any) => [
        entry.LoanInfo.asset,
        entry.LoanInfo.collateralAsset,
      ])
    ),
  ];

  // Fetch token metadata and build a lookup map
  const tokenMap = new Map(
    (
      await getTokens(accessToken, {
        address: `in.(${tokenAddresses.join(",")})`,
      })
    ).map((t: any) => [t.address, t])
  );

  const now = Math.floor(Date.now() / 1000);
  const divisor = BigInt(365 * 24 * 60 * 100); // Interest annualization factor

  // Return structured array of enriched loan objects
  return combinedLoans.map((entry: any) => {
    const loan = entry.LoanInfo;
    const key = entry.key;

    const assetToken = tokenMap.get(loan.asset) as any;
    const collateralToken = tokenMap.get(loan.collateralAsset) as any;

    return {
      key,
      loan: {
        ...loan,
        assetName: assetToken?._name || "",
        assetSymbol: assetToken?._symbol || "",
        collateralName: collateralToken?._name || "",
        collateralSymbol: collateralToken?._symbol || "",
        interest: loan.lastUpdated
          ? (
              (BigInt(loan.amount) *
                BigInt(registry.lendingPool.interestRate?.[loan.asset] || 0) *
                BigInt(Math.max(0, now - Number(loan.lastUpdated)) + 300)) /
              divisor
            ).toString()
          : "0",
      },
    };
  });
};

export const setPrice = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const registry = await getPool(accessToken);
    const priceOracleAddr = typeof registry.oracle === "string"
      ? registry.oracle
      : registry.oracle?.address || "";
    if (!priceOracleAddr) {
      throw new Error("Price oracle address not found");
    }
    const tx = buildFunctionTx({
      contractName: extractContractName(PriceOracle),
      contractAddress: priceOracleAddr,
      method: "setAssetPrice",
      args: {
        asset: body.token,
        price: body.price,
      },
    });

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return {
      status,
      hash,
    };
  } catch (error) {
    console.error("Error setting price:", error);
    throw error;
  }
};

// ------------------ Price queries ------------------
export const getPrice = async (
  accessToken: string,
  asset?: string
) => {
  // Fetch full registry so nested oracle.prices are included
  const registry = await getPool(accessToken);

  const prices: { asset: string; price: string }[] = registry.oracle
    ? registry.oracle.prices || []
    : [];

  if (asset) {
    const entry = prices.find(
      (p) => p.asset.toLowerCase() === asset.toLowerCase()
    );
    if (!entry) {
      throw new Error(`Price not found for asset ${asset}`);
    }
    return entry;
  }

  return prices;
};

// ---------------- Liquidation services ----------------

/** Build quick lookup maps needed for HF calculation */
const buildMaps = (registry: any) => {
  const priceMap = new Map<string, bigint>(
    (registry.oracle.prices || []).map((p: any) => [p.asset, toBig(p.price)])
  );
  const ratioMap = new Map<string, number>(
    (registry.lendingPool.collateralRatio || []).map((r: any) => [r.asset, r.ratio])
  );
  return { priceMap, ratioMap };
};

const calculateHealthFactor = (
  loan: any,
  priceMap: Map<string, bigint>,
  ratioMap: Map<string, number>
) => {
  const loanPrice = priceMap.get(loan.asset) || 0n;
  const collPrice = priceMap.get(loan.collateralAsset) || 0n;
  const loanValue = (toBig(loan.amount) * loanPrice) / 10n ** 18n;
  const collValue = (toBig(loan.collateralAmount) * collPrice) / 10n ** 18n;
  const ratio = BigInt(ratioMap.get(loan.collateralAsset) || 0);
  if (ratio === 0n || loanValue === 0n) return Infinity;
  const hfNumerator = collValue * 100n;
  const hfDenominator = loanValue * ratio;
  return Number((hfNumerator * 10000n) / hfDenominator) / 10000; // 4 decimal precision
};

export const listLiquidatableLoans = async (accessToken: string) => {
  const registry = await getPool(accessToken);
  const { priceMap, ratioMap } = buildMaps(registry);

  const loans = (registry.lendingPool.loans || []) as any[];

  // Fetch token metadata for unique addresses
  const tokenAddresses = [
    ...new Set(
      loans.flatMap((e) => [e.LoanInfo.asset, e.LoanInfo.collateralAsset])
    ),
  ];
  const tokenMap = new Map(
    (
      await getTokens(accessToken, {
        address: `in.(${tokenAddresses.join(',')})`,
      })
    ).map((t: any) => [t.address, t])
  );

  return loans
    .filter((e) => e.LoanInfo?.active)
    .map((e) => {
      const hf = calculateHealthFactor(e.LoanInfo, priceMap, ratioMap);
      const loan = e.LoanInfo;
      const assetToken = tokenMap.get(loan.asset) as any;
      const collToken = tokenMap.get(loan.collateralAsset) as any;
      return {
        id: e.key,
        healthFactor: hf,
        assetSymbol: assetToken?._symbol || '',
        collateralSymbol: collToken?._symbol || '',
        ...loan,
      };
    })
    .filter((l) => l.healthFactor < 1);
};

export const listNearUnhealthyLoans = async (
  accessToken: string,
  margin: number
) => {
  const registry = await getPool(accessToken);
  const { priceMap, ratioMap } = buildMaps(registry);
  const upper = 1 + margin;
  const loans = (registry.lendingPool.loans || []) as any[];

  const tokenAddresses = [
    ...new Set(
      loans.flatMap((e) => [e.LoanInfo.asset, e.LoanInfo.collateralAsset])
    ),
  ];
  const tokenMap = new Map(
    (
      await getTokens(accessToken, {
        address: `in.(${tokenAddresses.join(',')})`,
      })
    ).map((t: any) => [t.address, t])
  );

  return loans
    .filter((e) => e.LoanInfo?.active)
    .map((e) => {
      const hf = calculateHealthFactor(e.LoanInfo, priceMap, ratioMap);
      const loan = e.LoanInfo;
      const assetToken = tokenMap.get(loan.asset) as any;
      const collToken = tokenMap.get(loan.collateralAsset) as any;
      return {
        id: e.key,
        healthFactor: hf,
        assetSymbol: assetToken?._symbol || '',
        collateralSymbol: collToken?._symbol || '',
        ...loan,
      };
    })
    .filter((l) => l.healthFactor >= 1 && l.healthFactor < upper);
};

export const getLoanByIdDirect = async (
  accessToken: string,
  id: string
) => {
  const registry = await getPool(accessToken);
  const found = (registry.lendingPool.loans || []).find((e: any) => e.key === id);
  if (!found) return null;
  return found.LoanInfo;
};

export const executeLiquidation = async (
  accessToken: string,
  loanId: string
) => {
  // Fetch liquidityPool address directly to avoid accidentally passing the whole object
  const { liquidityPool } = await getPool(accessToken, { select: "liquidityPool" });
  if (!liquidityPool || typeof liquidityPool !== "string") {
    throw new Error("Liquidity pool address not found");
  }
  const liquidityPoolAddr = liquidityPool;

  // Fetch full registry to locate the loan details
  const registry = await getPool(accessToken);
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
      contractAddress: constants.lendingPool,
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
    // Surface Strato's response for easier debugging
    console.error("[executeLiquidation] Strato 400 response", error?.response?.data || error);
    throw error;
  }
};

export const getLoanWithHealthFactor = async (
  accessToken: string,
  id: string
) => {
  const registry = await getPool(accessToken);
  const found = (registry.lendingPool.loans || []).find((e: any) => e.key === id);
  if (!found) return null;
  const loan = found.LoanInfo;
  const { priceMap, ratioMap } = buildMaps(registry);
  const healthFactor = calculateHealthFactor(loan, priceMap, ratioMap);
  return { id, healthFactor, ...loan };
};

const toBig = (v: string | number | bigint) => BigInt(v);
