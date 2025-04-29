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
    // 1. Clean incoming params and force the pool address
    const params = Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ) as Record<string, string>;
    params.address = "eq." + constants.lendingPool;

    // 2. Base fetch (no heavy selects)
    const baseResponse = await cirrus.get(
      accessToken,
      `/BlockApps-Mercata-LendingPoolBase`,
      { params }
    );
    if (baseResponse.status !== 200) {
      throw new Error(`Error fetching lending pools: ${baseResponse.statusText}`);
    }
    if (!baseResponse.data || baseResponse.data.length === 0) {
      throw new Error("Pool data is empty");
    }
    const poolData: Record<string, any> = baseResponse.data[0];

    // 3. Define the four relations you need
    const requiredRelations = [
      "BlockApps-Mercata-LendingPoolBase-loans(*)",
      "BlockApps-Mercata-LendingPoolBase-assetInterestRate(*)",
      "BlockApps-Mercata-LendingPoolBase-assetCollateralRatio(*)",
      "BlockApps-Mercata-LendingPoolBase-assetLiquidationBonus(*)",
    ];

    // 4. Fetch each relation separately and attach under its field name
    for (const rel of requiredRelations) {
      const relResponse = await cirrus.get(
        accessToken,
        `/BlockApps-Mercata-LendingPoolBase`,
        {
          params: {
            address: "eq." + constants.lendingPool,
            select: rel,
          },
        }
      );
      if (relResponse.status !== 200) {
        throw new Error(`Error fetching relation ${rel}: ${relResponse.statusText}`);
      }
      Object.assign(poolData, relResponse.data[0]);
    }

    return [poolData];

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
