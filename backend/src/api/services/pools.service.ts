import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { usc } from "../../utils/importer";
import { StratoPaths, constants } from "../../config/constants";
import {
  getInputPrice,
  getOutputPrice,
  getPoolBalances,
} from "../helpers/pools.helper";

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
    console.error("Error creating pool:", error);
    throw error;
  }
};

export const addLiquidity = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: Pool,
      contractAddress: body.address || "",
      method: "addLiquidity",
      args: {
        stable_amount: body.stable_amount,
        max_tokens: body.max_tokens,
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
    const tx = buildFunctionTx({
      contractName: Pool,
      contractAddress: body.address || "",
      method: "removeLiquidity",
      args: {
        amount: body.amount,
        min_stable: body.min_stable,
        min_tokens: body.min_tokens,
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
    const isStableToToken = body.method === "stableToToken";
    const tx = buildFunctionTx({
      contractName: Pool,
      contractAddress: body.address || "",
      method: body.method || "",
      args: {
        [isStableToToken ? "stable_sold" : "tokens_sold"]: body.amount,
        min_stable: body.min_stable,
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

export const getStableToTokenInputPrice = async (
  accessToken: string,
  params: { stable_sold: bigint; address: string }
): Promise<bigint> => {
  if (params.stable_sold <= 0n) {
    throw new Error("Invalid stable amount");
  }

  try {
    const { tokenBalance, stableBalance } = await getPoolBalances(
      accessToken,
      params.address
    );

    return getInputPrice(params.stable_sold, stableBalance, tokenBalance);
  } catch (error) {
    console.error("Error calculating price:", error);
    throw error;
  }
};

export const getStableToTokenOutputPrice = async (
  accessToken: string,
  params: { tokens_bought: bigint; address: string }
): Promise<bigint> => {
  if (params.tokens_bought <= 0n) {
    throw new Error("Invalid token amount");
  }

  try {
    const { tokenBalance, stableBalance } = await getPoolBalances(
      accessToken,
      params.address
    );

    return getOutputPrice(params.tokens_bought, stableBalance, tokenBalance);
  } catch (error) {
    console.error("Error calculating price:", error);
    throw error;
  }
};

export const getTokenToStableInputPrice = async (
  accessToken: string,
  params: { tokens_sold: bigint; address: string }
): Promise<bigint> => {
  if (params.tokens_sold <= 0n) {
    throw new Error("Invalid token amount");
  }

  try {
    const { tokenBalance, stableBalance } = await getPoolBalances(
      accessToken,
      params.address
    );

    return getInputPrice(params.tokens_sold, tokenBalance, stableBalance);
  } catch (error) {
    console.error("Error calculating price:", error);
    throw error;
  }
};

export const getTokenToStableOutputPrice = async (
  accessToken: string,
  params: { stable_bought: bigint; address: string }
): Promise<bigint> => {
  if (params.stable_bought <= 0n) {
    throw new Error("Invalid stable amount");
  }

  try {
    const { tokenBalance, stableBalance } = await getPoolBalances(
      accessToken,
      params.address
    );

    return getOutputPrice(params.stable_bought, tokenBalance, stableBalance);
  } catch (error) {
    console.error("Error calculating price:", error);
    throw error;
  }
};

export const getCurrentTokenPrice = async (
  accessToken: string,
  params: { address: string }
): Promise<string> => {
  try {
    const { tokenBalance, stableBalance } = await getPoolBalances(
      accessToken,
      params.address
    );

    return ((stableBalance * constants.DECIMALS) / tokenBalance).toString();
  } catch (error) {
    console.error("Error calculating current token price:", error);
    throw error;
  }
};

export const getCurrentStablePrice = async (
  accessToken: string,
  params: { address: string }
): Promise<bigint> => {
  try {
    const { tokenBalance, stableBalance } = await getPoolBalances(
      accessToken,
      params.address
    );

    return (tokenBalance * constants.DECIMALS) / stableBalance;
  } catch (error) {
    console.error("Error calculating current stable price:", error);
    throw error;
  }
};
