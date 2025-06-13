import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { getInputPrice } from "../helpers/swapping.helper";
import { approveAsset } from "../helpers/tokens.helper";
import { getPool as getLendingRegistry } from "./lending.service";

const { poolSelectFields, Pool, PoolFactory, PriceOracle } = constants;

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
    ...(rawParams.select
      ? {}
      : {
          "lpToken.balances.value": "gt.0",
          ...(address ? { "lpToken.balances.key": `eq.${address}` } : {}),
          "tokenA.balances.value": "gt.0",
          ...(address ? { "tokenA.balances.key": `eq.${address}` } : {}),
          "tokenB.balances.value": "gt.0",
          ...(address ? { "tokenB.balances.key": `eq.${address}` } : {}),
        }),
    root: `eq.${constants.baseCodeCollection}`,
  };

  const { data: poolData } = await cirrus.get(accessToken, `/${Pool}`, {
    params,
  });

  const lendingInfo = await getLendingRegistry(accessToken, {
    select: `oracle:priceOracle_fkey(address,prices:${PriceOracle}-prices(key,value))`,
  });

  const rawPrices = lendingInfo.oracle?.prices || [];
  const priceMap = new Map<string, number>(
    rawPrices.map((p: any) => [p.key, p.value])
  );
  return poolData.map((pool: any) => ({
    ...pool,
    ...(pool.tokenA?.address && { tokenAPrice: priceMap.get(pool.tokenA.address) || "0" }),
    ...(pool.tokenB?.address && { tokenBPrice: priceMap.get(pool.tokenB.address) || "0" }),
    ...(pool.lpToken?.address && { lpTokenPrice: priceMap.get(pool.lpToken.address) || "0" })
  }));
};

export const createPool = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: extractContractName(PoolFactory),
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
      contractName: extractContractName(Pool),
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
      BigInt(pool.lpToken._totalSupply);
    const tokenB_amount =
      (BigInt(pool.tokenBBalance) * BigInt(body.amount || "0")) /
      BigInt(pool.lpToken._totalSupply);
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
      contractName: extractContractName(Pool),
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
      contractName: extractContractName(Pool),
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
