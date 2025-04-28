import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";

const Pool = "LendingPoolBase";
const ERC20 = "ERC20";

export const getPools = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  try {
    // Filter out undefined values (cleaning for axios)
    const params = Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ) as Record<string, string>;
    params.address = "eq." + constants.lendingPool;
    // Ensure all required relations are selected
    const requiredRelations = [
      "BlockApps-Mercata-LendingPoolBase-loans(*)",
      "BlockApps-Mercata-LendingPoolBase-assetInterestRate(*)",
      "BlockApps-Mercata-LendingPoolBase-assetCollateralRatio(*)",
      "BlockApps-Mercata-LendingPoolBase-assetLiquidationBonus(*)",
    ];
    // Clean and build select parameter
    const existingSelect = params.select
      ? Array.from(new Set(params.select.split(",")))
      : ["*"];
    requiredRelations.forEach((rel) => {
      if (!existingSelect.includes(rel)) {
        existingSelect.push(rel);
      }
    });
    params.select = existingSelect.join(",");

    const response = await cirrus.get(
      accessToken,
      `/BlockApps-Mercata-LendingPoolBase`,
      {
        params,
      }
    );

    if (response.status !== 200) {
      throw new Error(`Error fetching lending pools: ${response.statusText}`);
    }

    if (!response.data) {
      throw new Error("Pool data is empty");
    }

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
    let tx: any = null;
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

      tx = buildFunctionTx({
        contractName: ERC20,
        contractAddress: body.asset || "",
        method: "approve",
        args: {
          spender: liquidityPool,
          value: body.amount,
        },
      });

      let { status: approveStatus, hash: approveHash } = await postAndWaitForTx(
        accessToken,
        () => strato.post(accessToken, StratoPaths.transactionParallel, tx)
      );

      if (approveStatus !== "Success") {
        throw new Error(`Error approving asset with hash: ${approveHash}`);
      }
    }

    tx = buildFunctionTx({
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

    let tx = buildFunctionTx({
      contractName: ERC20,
      contractAddress: body.collateralAsset || "",
      method: "approve",
      args: {
        spender: collateralVault,
        value: body.collateralAmount,
      },
    });

    let { status: approveStatus, hash: approveHash } = await postAndWaitForTx(
      accessToken,
      () => strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    if (approveStatus !== "Success") {
      throw new Error(`Error approving asset with hash: ${approveHash}`);
    }

    tx = buildFunctionTx({
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

    let tx = buildFunctionTx({
      contractName: ERC20,
      contractAddress: body.asset || "",
      method: "approve",
      args: {
        spender: liquidityPool,
        value: body.amount,
      },
    });

    let { status: approveStatus, hash: approveHash } = await postAndWaitForTx(
      accessToken,
      () => strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    if (approveStatus !== "Success") {
      throw new Error(`Error approving asset with hash: ${approveHash}`);
    }

    tx = buildFunctionTx({
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
