import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildDeployTx, buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { combine, usc, cwd } from "../../utils/importer";
import { StratoPaths } from "../../config/constants";

const Pool = "DemoLending";
const ERC20 = "ERC20";
const contractPathFactory = `${cwd}/src/api/contracts/${Pool}.sol`;

export const getPools = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  try {
    // Filter out undefined values (cleaning for axios)
    const params = Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ) as Record<string, string>;

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
    console.error("Error fetching leding pools:", error);
    throw error;
  }
};

export const createPool = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildDeployTx({
      contractName: Pool,
      source: await combine(contractPathFactory),
      args: usc(body),
    });

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return {
      status,
      hash,
    };
  } catch (error) {
    console.error("Error creating lending pool:", error);
    throw error;
  }
};

export const manageLiquidity = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    let tx = buildFunctionTx({
      contractName: ERC20,
      contractAddress: body.asset || "",
      method: "approve",
      args: {
        asset: body.address,
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
      contractAddress: body.address || "",
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
    let tx = buildFunctionTx({
      contractName: ERC20,
      contractAddress: body.asset || "",
      method: "approve",
      args: {
        asset: body.address,
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
      contractAddress: body.address || "",
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
    let tx = buildFunctionTx({
      contractName: ERC20,
      contractAddress: body.asset || "",
      method: "approve",
      args: {
        asset: body.address,
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
      contractAddress: body.address || "",
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
