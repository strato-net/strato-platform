import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { approveAsset } from "../helpers/tokens.helper";
import { getBalance, getTokens } from "./tokens.service";

const { lendingPoolSelectFields, lendingPool } = constants;
const Pool = "LendingPool";

export const getPool = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  const params = {
    ...Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ),
    select: rawParams.select || lendingPoolSelectFields.join(","),
    address: `eq.${lendingPool}`,
  };

  const {
    data: [poolData],
  } = await cirrus.get(accessToken, `/${Pool}`, { params });

  if (!poolData) throw new Error("Error fetching pool data from Cirrus");

  // Parallel fetch oracle and liquidity pool if addresses exist
  const [oracleData, liquidityPoolData] = await Promise.all([
    poolData.oracle
      ? cirrus
          .get(accessToken, "/PriceOracle", {
            params: {
              address: `eq.${poolData.oracle}`,
              select: "address,prices:PriceOracle-prices(*)",
            },
          })
          .then((r) => r.data?.[0])
      : null,

    poolData.liquidityPool
      ? cirrus
          .get(accessToken, "/LiquidityPool", {
            params: {
              address: `eq.${poolData.liquidityPool}`,
              select:
                "address,totalLiquidity:LiquidityPool-totalLiquidity(*),deposited:LiquidityPool-deposited(*)",
            },
          })
          .then((r) => r.data?.[0])
      : null,
  ]);

  return {
    ...poolData,
    oracle: oracleData || poolData.oracle,
    liquidityPool: liquidityPoolData || poolData.liquidityPool,
    collateralVault: { address: poolData.collateralVault },
  };
};

export const manageLiquidity = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    if (body.method === "depositLiquidity") {
      const response = await getPool(accessToken, {
        select: "liquidityPool",
      });
      const liquidityPool = response.liquidityPool.address;

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
    const response = await getPool(accessToken, {
      select: "collateralVault",
    });
    const collateralVault = response.collateralVault.address;

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
    const response = await getPool(accessToken, {
      select: "liquidityPool",
    });
    const liquidityPool = response.liquidityPool.address;

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
  const [pool, userTokens] = await Promise.all([
    getPool(accessToken),
    getBalance(accessToken, address),
  ]);

  const userTokenMap = new Map(userTokens.map((t: any) => [t.address, t]));

  return Object.entries(pool.assetCollateralRatio || {})
    .filter(
      ([token]) =>
        pool.oracle?.prices?.[token] !== undefined && userTokenMap.has(token)
    )
    .map(([token, collateralRatio]) => {
      const userToken = userTokenMap.get(token) as any;
      return {
        address: token,
        _name: userToken?.token?._name || "",
        _symbol: userToken?.token?._symbol || "",
        value: userToken?.balance?.toString() || "0",
        collateralRatio: collateralRatio || 0,
        interestRate: pool.assetInterestRate?.[token] || 0,
        price: pool.oracle?.prices?.[token] || 0,
        liquidity: pool.liquidityPool?.totalLiquidity?.[token] || "0",
      };
    });
};

export const getWithdrawableTokens = async (
  accessToken: string,
  address: string
): Promise<
  { address: string; _name: string; _symbol: string; value: string }[]
> => {
  const pool = await getPool(accessToken);

  const userDeposits = Object.values(
    pool.liquidityPool?.deposited || {}
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
  const pool = await getPool(accessToken);

  const userLoans = Object.entries(pool.loans || {}).filter(
    ([_, loan]: [string, any]) => loan.user === address && loan?.active
  );

  if (!userLoans.length) return { ...pool, loans: {} };

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
    ...pool,
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
                BigInt(pool.assetInterestRate?.[loan.asset] || 0) *
                BigInt(Math.max(0, now - Number(loan.lastUpdated)) + 300)) /
              divisor
            ).toString(),
          },
        ];
      })
    ),
  };
};
