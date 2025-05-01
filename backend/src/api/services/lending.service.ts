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
    const meta = userToken["BlockApps-Mercata-ERC20"];
    return {
      address: token,
      _name: meta._name,
      _symbol: meta._symbol,
      value: userToken.value,
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
