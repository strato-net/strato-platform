import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { approveAsset } from "../helpers/tokens.helper";
import { getBalance, getTokens } from "./tokens.service";

const { registrySelectFields, lendingPool } = constants;
const Pool = "LendingPool";
const Registry = "LendingRegistry";

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
  } = await cirrus.get(accessToken, `/${Registry}`, { params });

  if (!poolData) {
    throw new Error(`Error fetching ${Registry} data from Cirrus`);
  }

  return poolData;
};

export const manageLiquidity = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    if (body.method === "depositLiquidity") {
      const lendingPool = await getPool(accessToken, {
        select: "liquidityPool",
      });
      const liquidityPool = lendingPool.liquidityPool;

      await approveAsset(
        accessToken,
        body.asset || "",
        liquidityPool,
        body.amount || ""
      );
    }

    const tx = buildFunctionTx({
      contractName: Pool,
      contractAddress: constants.lendingPool,
      method: body.method || "",
      args: {
        asset: body.asset,
        amount: body.amount,
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
    console.error(`Error managing liquidity (${body.method}):`, error);
    throw error;
  }
};

export const getLoan = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const lendingPool = await getPool(accessToken, {
      select: "collateralVault",
    });
    const collateralVault = lendingPool.collateralVault;

    await approveAsset(
      accessToken,
      body.collateralAsset || "",
      collateralVault,
      body.collateralAmount || ""
    );

    const tx = buildFunctionTx({
      contractName: Pool,
      contractAddress: constants.lendingPool,
      method: "getLoan",
      args: {
        asset: body.asset,
        amount: body.amount,
        collateralAsset: body.collateralAsset,
        collateralAmount: body.collateralAmount,
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
    console.error("Error getting loan:", error);
    throw error;
  }
};

export const repayLoan = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const lendingPool = await getPool(accessToken, {
      select: "liquidityPool",
    });
    const liquidityPool = lendingPool.liquidityPool;

    await approveAsset(
      accessToken,
      body.asset || "",
      liquidityPool,
      body.amount || ""
    );

    const tx = buildFunctionTx({
      contractName: Pool,
      contractAddress: constants.lendingPool,
      method: "repayLoan",
      args: {
        loanId: body.loanId,
        amount: body.amount,
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

  return Object.entries(registry.lendingPool.collateralRatio || {})
    .filter(
      ([token]) =>
        registry.oracle?.prices?.[token] !== undefined &&
        userTokenMap.has(token)
    )
    .map(([token, collateralRatio]) => {
      const userToken = userTokenMap.get(token) as any;
      return {
        address: token,
        _name: userToken?.token?._name || "",
        _symbol: userToken?.token?._symbol || "",
        value: userToken?.balance?.toString() || "0",
        collateralRatio: collateralRatio || 0,
        interestRate: registry.lendingPool.interestRate?.[token] || 0,
        price: registry.oracle?.prices?.[token] || 0,
        liquidity: registry.liquidityPool?.totalLiquidity?.[token] || "0",
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

  const userDeposits = Object.values(
    registry.liquidityPool?.deposited || {}
  ).filter((d: any) => d.user === address) as {
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
): Promise<any> => {
  const registry = await getPool(accessToken);

  const userLoans = Object.entries(registry.lendingPool.loans || {}).filter(
    ([_, loan]: [string, any]) => loan.user === address && loan.amount > 0
  );

  if (!userLoans.length) return { ...registry.lendingPool, loans: {} };

  const tokenMap = new Map(
    (
      await getTokens(accessToken, {
        address: `in.(${[
          ...new Set(
            userLoans.flatMap(([_, l]: [string, any]) => [
              l.asset,
              l.collateralAsset,
            ])
          ),
        ].join(",")})`,
      })
    ).map((t: any) => [t.address, t])
  );

  const now = Math.floor(Date.now() / 1000);
  const divisor = BigInt(365 * 24 * 60 * 100);

  return {
    ...registry.lendingPool,
    loans: Object.fromEntries(
      userLoans.map(([key, loan]: [string, any]) => {
        const assetToken = tokenMap.get(loan.asset) as any;
        const collateralToken = tokenMap.get(loan.collateralAsset) as any;

        return [
          key,
          {
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
        ];
      })
    ),
  };
};
