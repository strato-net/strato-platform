import { cirrus, strato, bloc } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { approveAsset } from "../helpers/tokens.helper";

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
