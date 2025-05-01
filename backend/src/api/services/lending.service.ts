import { cirrus, strato, bloc } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { approveAsset } from "../helpers/tokens.helper";
import { getBalance, getTokens } from "./tokens.service";

const Pool = "LendingPoolBase";

export const getPools = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  try {
    const response = await bloc.get(
      accessToken,
      StratoPaths.state.replace(":contractAddress", constants.lendingPool)
    );

    return response.data;
  } catch (error) {
    console.error("Error fetching lending pools:", error);
    throw error;
  }
};

export const manageLiquidity = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    if (body.method === "depositLiquidity") {
      const response = await cirrus.get(
        accessToken,
        `/BlockApps-Mercata-LendingPoolBase`,
        {
          params: {
            address: "eq." + constants.lendingPool,
            select: "liquidityPool",
          },
        }
      );

      if (response.status !== 200) {
        throw new Error(
          `Error fetching lending pool address: ${response.statusText}`
        );
      }
      if (!response.data || response.data.length === 0) {
        throw new Error("Pool data is empty");
      }
      const liquidityPool = response.data[0].liquidityPool;

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
    const response = await cirrus.get(
      accessToken,
      `/BlockApps-Mercata-LendingPoolBase`,
      {
        params: {
          address: "eq." + constants.lendingPool,
          select: "collateralVault",
        },
      }
    );

    if (response.status !== 200) {
      throw new Error(
        `Error fetching lending pool address: ${response.statusText}`
      );
    }
    if (!response.data || response.data.length === 0) {
      throw new Error("Pool data is empty");
    }
    const collateralVault = response.data[0].collateralVault;

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
    const response = await cirrus.get(
      accessToken,
      `/BlockApps-Mercata-LendingPoolBase`,
      {
        params: {
          address: "eq." + constants.lendingPool,
          select: "liquidityPool",
        },
      }
    );

    if (response.status !== 200) {
      throw new Error(
        `Error fetching lending pool address: ${response.statusText}`
      );
    }
    if (!response.data || response.data.length === 0) {
      throw new Error("Pool data is empty");
    }
    const liquidityPool = response.data[0].liquidityPool;

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
): Promise<{ _name: string; _symbol: string; value: string }[]> => {
  // Fetch pool data
  const { data: pool } = await bloc.get(
    accessToken,
    StratoPaths.state.replace(":contractAddress", constants.lendingPool)
  );
  if (!pool) {
    throw new Error("Lending pool data is empty");
  }
  const { assetCollateralRatio = {}, oracle: oracleAddress } = pool;
  const ratioTokens = Object.keys(assetCollateralRatio);

  // Concurrently fetch oracle data and user balances
  const [oracleResponse, userTokens] = await Promise.all([
    bloc.get(
      accessToken,
      StratoPaths.state.replace(":contractAddress", oracleAddress)
    ),
    getBalance(accessToken, { key: "eq." + address }),
  ]);

  const { data: oracle } = oracleResponse;
  if (!oracle) {
    throw new Error("Oracle data is empty");
  }
  const prices = oracle.prices || {};

  // Create a set for faster lookups
  const userAddressSet = new Set(userTokens.map((t: any) => t.address));

  // Filter tokens present in collateral ratio, oracle prices, and user balances
  const depositable = ratioTokens.filter(
    (token) => token in prices && userAddressSet.has(token)
  );
  return depositable.map((token) => {
    const userToken = userTokens.find((t: any) => t.address === token)!;
    const collateralRatio = assetCollateralRatio[token];
    const interestRate = pool.assetInterestRate[token] || "0";
    const price = prices[token];
    const meta = userToken["BlockApps-Mercata-ERC20"];
    return {
      address: token,
      _name: meta._name,
      _symbol: meta._symbol,
      value: userToken.value,
      collateralRatio,
      interestRate,
      price,
    };
  });
};

export const getWithdrawableTokens = async (
  accessToken: string,
  address: string
): Promise<{ _name: string; _symbol: string; value: string }[]> => {
  // Fetch pool data
  const { data: pool } = await bloc.get(
    accessToken,
    StratoPaths.state.replace(":contractAddress", constants.lendingPool)
  );
  if (!pool) {
    throw new Error("Lending pool data is empty");
  }
  const { data: liquidityPool } = await bloc.get(
    accessToken,
    StratoPaths.state.replace(":contractAddress", pool.liquidityPool)
  );
  if (!liquidityPool) {
    throw new Error("Liquidity pool data is empty");
  }
  // Get deposited records and filter by user address
  const deposited = liquidityPool.deposited || {};
  const userDeposits = Object.values(deposited).filter(
    (d: any) => d.user === address
  ) as { asset: string; amount: string; user: string }[];

  if (userDeposits.length === 0) {
    return [];
  }
  const tokenMetadata = await getTokens(accessToken, {
    address: "in.(" + userDeposits.map((d) => d.asset).join(",") + ")",
  });
  const tokenMetadataMap = Object.fromEntries(
    tokenMetadata.map((t: any) => [t.address, t])
  );
  const metadatas = userDeposits.map((d) => tokenMetadataMap[d.asset]);
  if (!metadatas) {
    throw new Error("Token metadata is empty");
  }

  // Map to name, symbol, amount
  return userDeposits.map((d, i) => ({
    address: d.asset,
    _name: metadatas[i]._name,
    _symbol: metadatas[i]._symbol,
    value: d.amount,
  }));
};

export const getLoans = async (
  accessToken: string,
  address: string
): Promise<any> => {
  // Fetch pool data
  const { data: pool } = await bloc.get(
    accessToken,
    StratoPaths.state.replace(":contractAddress", constants.lendingPool)
  );
  if (!pool) {
    throw new Error("Lending pool data is empty");
  }

  // Filter only loans for this user
  const loansMap = pool.loans || {};
  const userLoansMap = Object.fromEntries(
    Object.entries(loansMap).filter(
      ([_, loan]: [string, any]) => loan.user === address
    )
  );

  // If no loans for this user, still return pool with empty loans object
  if (!Object.keys(userLoansMap).length) {
    return {
      ...pool,
      loans: {},
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const divisor = BigInt(365 * 24 * 60 * 100);

  // Fetch metadata for all assets and collateral assets in the user's loans
  const assetAddresses = Object.values(userLoansMap).map((l: any) => l.asset);
  const collateralAddresses = Object.values(userLoansMap).map(
    (l: any) => l.collateralAsset
  );
  const allAddresses = Array.from(
    new Set([...assetAddresses, ...collateralAddresses])
  );
  const tokenMetadata = await getTokens(accessToken, {
    address: "in.(" + allAddresses.join(",") + ")",
  });
  const metadataMap = Object.fromEntries(
    tokenMetadata.map((t: any) => [t.address, t])
  );

  // Enrich each loan entry with asset and collateral metadata
  const enrichedLoans = Object.fromEntries(
    Object.entries(userLoansMap).map(([key, loan]: [string, any]) => {
      const assetMeta = metadataMap[loan.asset] || {};
      const collateralMeta = metadataMap[loan.collateralAsset] || {};
      const lastUpdated = Number(loan.lastUpdated);
      const rawDuration = now > lastUpdated ? now - lastUpdated : 0;
      // convert duration to minutes, minimum 1 minute
      const baseMinutes = BigInt(Math.floor(rawDuration / 60) || 0);
      const minutes = baseMinutes + BigInt(5);
      const rate = Number(pool.assetInterestRate[loan.asset] || "0");
      const principal = BigInt(loan.amount);
      const interest = (principal * BigInt(rate) * minutes) / divisor;
      const interestStr = interest.toString();
      return [
        key,
        {
          ...loan,
          assetName: assetMeta._name,
          assetSymbol: assetMeta._symbol,
          collateralName: collateralMeta._name,
          collateralSymbol: collateralMeta._symbol,
          interest: interestStr,
        },
      ];
    })
  );

  // Return the full pool object with only the user's enriched loans
  return {
    ...pool,
    loans: enrichedLoans,
  };
};
