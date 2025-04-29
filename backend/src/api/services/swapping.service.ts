import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { usc } from "../../utils/importer";
import { StratoPaths, constants } from "../../config/constants";
import { getInputPrice } from "../helpers/swapping.helper";

const Pool = "DemoPool";
const PoolFactory = "DemoPoolFactory";

export const getPools = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  try {
    // Filter out undefined values from query
    const params = Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ) as Record<string, string>;

    params.root = `eq.${constants.poolFactory}`;

    const cirrusResponse = await cirrus.get(
      accessToken,
      `/BlockApps-Mercata-ERC20`,
      { params }
    );

    if (cirrusResponse.status !== 200 || !Array.isArray(cirrusResponse.data)) {
      throw new Error("Error fetching pool data from Cirrus");
    }

    const poolData = cirrusResponse.data;

    return poolData;
  } catch (error) {
    console.error("Error fetching pools:", error);
    throw error;
  }
};

export const createPool = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: PoolFactory,
      contractAddress: constants.poolFactory,
      method: "createPool",
      args: body,
    });

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return {
      status,
      hash,
    };
  } catch (error) {
    console.error("Error creating pool:", error);
    throw error;
  }
};

export const addLiquidity = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const pool = await getPools(accessToken, {
      address: "eq." + body.address,
      select: "data->>tokenA,data->>tokenB",
    });

    let tx = buildFunctionTx({
      contractName: "ERC20",
      contractAddress: pool[0].tokenA || "",
      method: "approve",
      args: {
        spender: body.address,
        value: body.max_tokenA_amount,
      },
    });

    let { status: approveStatus1, hash: approveHash1 } = await postAndWaitForTx(
      accessToken,
      () => strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    if (approveStatus1 !== "Success") {
      throw new Error(`Error approving asset with hash: ${approveHash1}`);
    }

    tx = buildFunctionTx({
      contractName: "ERC20",
      contractAddress: pool[0].tokenB || "",
      method: "approve",
      args: {
        spender: body.address,
        value: body.tokenB_amount,
      },
    });

    let { status: approveStatus2, hash: approveHash2 } = await postAndWaitForTx(
      accessToken,
      () => strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    if (approveStatus2 !== "Success") {
      throw new Error(`Error approving asset with hash: ${approveHash2}`);
    }

    tx = buildFunctionTx({
      contractName: Pool,
      contractAddress: body.address || "",
      method: "addLiquidity",
      args: {
        tokenB_amount: body.tokenB_amount,
        max_tokenA_amount: body.max_tokenA_amount,
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
    console.error("Error adding liquidity:", error);
    throw error;
  }
};

export const removeLiquidity = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const pool = await getPools(accessToken, {
      address: "eq." + body.address,
    });
    // calculate tokenA and tokenB amounts
    const tokenA_amount =
      (BigInt(pool[0].data.tokenABalance) * BigInt(body.amount || "0")) /
      BigInt(pool[0]._totalSupply);
    const tokenB_amount =
      (BigInt(pool[0].data.tokenBBalance) * BigInt(body.amount || "0")) /
      BigInt(pool[0]._totalSupply);
    // Apply 1% slippage tolerance
    const slippageFactor = BigInt(99); // 99%
    const min_tokenA_amount = ((tokenA_amount * slippageFactor) / BigInt(100)).toString();
    const min_tokenB_amount = ((tokenB_amount * slippageFactor) / BigInt(100)).toString();
    const tx = buildFunctionTx({
      contractName: Pool,
      contractAddress: body.address || "",
      method: "removeLiquidity",
      args: {
        amount: body.amount,
        min_tokenB: min_tokenB_amount,
        min_tokenA_amount: min_tokenA_amount,
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
    console.error("Error removing liquidity:", error);
    throw error;
  }
};

export const swap = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const isTokenAToTokenB = body.method === "tokenAToTokenB";
    const response = await cirrus.get(accessToken, `/BlockApps-Mercata-ERC20`, {
      params: {
        address: "eq." + body.address,
        select: "data->>tokenA,data->>tokenB",
      },
    });

    if (response.status !== 200) {
      throw new Error(
        `Error fetching swap pool address: ${response.statusText}`
      );
    }
    if (!response.data || response.data.length === 0) {
      throw new Error("Pool data is empty");
    }
    const token = isTokenAToTokenB
      ? response.data[0].tokenA
      : response.data[0].tokenB;

    let tx = buildFunctionTx({
      contractName: "ERC20",
      contractAddress: token || "",
      method: "approve",
      args: {
        spender: body.address,
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
        [isTokenAToTokenB ? "tokenA_sold" : "tokenB_sold"]: body.amount,
        [isTokenAToTokenB ? "min_tokenB" : "min_tokens"]: body.min_tokens,
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
    console.error("Error swapping:", error);
    throw error;
  }
};

export const calculateSwap = async (
  accessToken: string,
  address: string,
  direction: string,
  amount: string
) => {
  try {
    const pools = await getPools(accessToken, { address: "eq." + address });

    if (!pools || pools.length === 0) {
      throw new Error("No pools found for the given address");
    }
    const pool = pools[0];
    if (direction === "true") {
      return getInputPrice(
        BigInt(amount),
        BigInt(pool.data.tokenBBalance),
        BigInt(pool.data.tokenABalance)
      );
    } else {
      return getInputPrice(
        BigInt(amount),
        BigInt(pool.data.tokenABalance),
        BigInt(pool.data.tokenBBalance)
      );
    }
  } catch (error) {
    console.error("Error calculating swap:", error);
    throw error;
  }
};
