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
        method: "getLoan",
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
    const lendingPool = await getPool(accessToken, {
      select: "liquidityPool",
    });

    if (!lendingPool?.liquidityPool) {
      throw new Error("Liquidity pool address not found");
    }

    const tx = buildFunctionTx([
      {
        contractName: extractContractName(Token),
        contractAddress: body.asset || "",
        method: "approve",
        args: { spender: lendingPool.liquidityPool, value: body.amount || "" },
      },
      {
        contractName: extractContractName(LendingPool),
        contractAddress: constants.lendingPool,
        method: "repayLoan",
        args: {
          asset: body.asset,
          amount: body.amount,
        },
      }
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

  if (!userLoans.length) return [];

  // Collect all unique token addresses used in user loans
  const tokenAddresses = [
    ...new Set(
      userLoans.flatMap((entry: any) => [
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
  return userLoans.map((entry: any) => {
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
        interest: (
          (BigInt(loan.amount) *
            BigInt(registry.lendingPool.interestRate?.[loan.asset] || 0) *
            BigInt(Math.max(0, now - Number(loan.lastUpdated)) + 300)) /
          divisor
        ).toString(),
      },
    };
  });
};

export const setPrice = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const registry = await getPool(accessToken, {
      select: "priceOracle",
    });
    const priceOracle = registry.priceOracle;
    const tx = buildFunctionTx({
      contractName: extractContractName(PriceOracle),
      contractAddress: priceOracle,
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
