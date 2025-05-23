import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { getInputPrice } from "../helpers/swapping.helper";
import { approveAsset } from "../helpers/tokens.helper";
import { getPool as getLendingPool } from "./lending.service";
import { getTokens } from "./tokens.service";

const { poolSelectFields } = constants;
const Pool = "Pool";
const PoolFactory = "PoolFactory";

export const getPools = async (
  accessToken: string,
  address: string | undefined,
  rawParams: Record<string, string | undefined> = {}
) => {
  const params = {
    ...Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ),
    select: rawParams.select || poolSelectFields.join(","),
    root: `eq.${constants.poolFactory}`,
  };

  const { data: poolData } = await cirrus.get(accessToken, `/${Pool}`, {
    params,
  });

  const tokenAddresses = [
    ...new Set(
      poolData.flatMap((pool: any) =>
        [pool.tokenA, pool.tokenB].filter(Boolean)
      )
    ),
  ];

  if (!tokenAddresses.length) return poolData;

  const [tokenMetadata, lendingInfo] = await Promise.all([
    getTokens(accessToken, {
      address: `in.(${tokenAddresses.join(",")})`,
      ["balances.key"]: `eq.${address}`,
    }),
    getLendingPool(accessToken, { select: "oracle" }),
  ]);
  const tokenMap = new Map(tokenMetadata.map((t: any) => [t.address, t]));
  const prices = lendingInfo.oracle?.prices || {};

  return poolData.map((pool: any) => ({
    ...pool,
    tokenAPrice: prices[pool.tokenA] || 0,
    tokenBPrice: prices[pool.tokenB] || 0,
    tokenA: tokenMap.get(pool.tokenA) || pool.tokenA,
    tokenB: tokenMap.get(pool.tokenB) || pool.tokenB,
  }));
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
    const pools = await getPools(accessToken, undefined, {
      address: "eq." + body.address,
      select: "tokenAAddress:tokenA,tokenBAddress:tokenB",
    });
    if (!pools || pools.length === 0) {
      throw new Error("No pools found for the given address");
    }
    const pool = pools[0];

    await approveAsset(
      accessToken,
      pool.tokenAAddress || "",
      body.address || "",
      body.max_tokenA_amount || ""
    );

    await approveAsset(
      accessToken,
      pool.tokenBAddress || "",
      body.address || "",
      body.tokenB_amount || ""
    );

    const tx = buildFunctionTx({
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
    const pools = await getPools(accessToken, undefined, {
      address: "eq." + body.address,
    });
    if (!pools || pools.length === 0) {
      throw new Error("No pools found for the given address");
    }
    const pool = pools[0];
    // calculate tokenA and tokenB amounts
    const tokenA_amount =
      (BigInt(pool.tokenABalance) * BigInt(body.amount || "0")) /
      BigInt(pool._totalSupply);
    const tokenB_amount =
      (BigInt(pool.tokenBBalance) * BigInt(body.amount || "0")) /
      BigInt(pool._totalSupply);
    // Apply 1% slippage tolerance
    const slippageFactor = BigInt(99); // 99%
    const min_tokenA_amount = (
      (tokenA_amount * slippageFactor) /
      BigInt(100)
    ).toString();
    const min_tokenB_amount = (
      (tokenB_amount * slippageFactor) /
      BigInt(100)
    ).toString();
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

    const pools = await getPools(accessToken, undefined, {
      address: "eq." + body.address,
      select: "tokenAAddress:tokenA,tokenBAddress:tokenB",
    });
    if (!pools || pools.length === 0) {
      throw new Error("No pools found for the given address");
    }
    const pool = pools[0];

    const token = isTokenAToTokenB ? pool.tokenAAddress : pool.tokenBAddress;

    await approveAsset(
      accessToken,
      token || "",
      body.address || "",
      body.amount || ""
    );

    const tx = buildFunctionTx({
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
    const pools = await getPools(accessToken, undefined, {
      address: "eq." + address,
    });

    if (!pools || pools.length === 0) {
      throw new Error("No pools found for the given address");
    }
    const pool = pools[0];
    if (direction === "true") {
      return getInputPrice(
        BigInt(amount),
        BigInt(pool.tokenBBalance),
        BigInt(pool.tokenABalance)
      );
    } else {
      return getInputPrice(
        BigInt(amount),
        BigInt(pool.tokenABalance),
        BigInt(pool.tokenBBalance)
      );
    }
  } catch (error) {
    console.error("Error calculating swap:", error);
    throw error;
  }
};
