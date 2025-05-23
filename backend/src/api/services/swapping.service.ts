import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { getInputPrice } from "../helpers/swapping.helper";
import { approveAsset } from "../helpers/tokens.helper";
import { getPools as getLendingPool } from "./lending.service";
import { getTokens } from "./tokens.service";

const { poolSelectFields } = constants;
const Pool = "Pool";
const PoolFactory = "PoolFactory";

export const getPools = async (
  accessToken: string,
  address: string | undefined,
  rawParams: Record<string, string | undefined> = {}
) => {
  try {
    // Step 1: Clean query params
    let params = Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ) as Record<string, string>;

    // Add default select fields
    if (!params.select) {
      params.select = poolSelectFields.join(",");
    }
    params.root = "eq." + constants.poolFactory;

    // Step 2: Fetch pools
    const cirrusResponse = await cirrus.get(accessToken, "/" + Pool, {
      params,
    });
    if (cirrusResponse.status !== 200 || !Array.isArray(cirrusResponse.data)) {
      throw new Error("Error fetching pool data from Cirrus");
    }
    const poolData = cirrusResponse.data;

    // Step 3: Collect all unique token addresses
    const tokenAddresses = Array.from(
      new Set(
        poolData.flatMap((pool) => [pool.tokenA, pool.tokenB].filter(Boolean))
      )
    );

    if (tokenAddresses.length === 0) {
      return poolData; // Return pools without token metadata
    }

    // Step 4: Fetch token metadata
    const tokenMetaResponse = await getTokens(accessToken, {
      address: `in.(${tokenAddresses.join(",")})`,
      ["balances.key"]: "eq." + address,
    });
    if (!Array.isArray(tokenMetaResponse)) {
      throw new Error("Token metadata response is not an array");
    }
    const tokenMetaMap = Array.isArray(tokenMetaResponse)
      ? tokenMetaResponse.reduce((map, token) => {
          map[token.address] = token;
          return map;
        }, {} as Record<string, any>)
      : {};

    // Step 5: Get oracle price info (fallback to 0 if unavailable)
    // let pricesMap: Record<string, string> = {};
    // try {
    //   const lendingInfo = await getLendingPool(accessToken);
    //   const oracleAddress = lendingInfo.oracle;

    //   const priceResponse = await bloc.get(
    //     accessToken,
    //     StratoPaths.state.replace(":contractAddress", oracleAddress)
    //   );

    //   if (priceResponse.status === 200 && priceResponse.data?.prices) {
    //     pricesMap = priceResponse.data.prices;
    //   }
    // } catch (err) {
    //   console.warn("Oracle price fetch failed, using default price 0");
    //   // pricesMap remains empty
    // }

    // Step 6: Decorate pool with token info + prices
    poolData.forEach((pool) => {
      pool.tokenA = tokenMetaMap[pool.tokenA] || pool.tokenA;
      pool.tokenB = tokenMetaMap[pool.tokenB] || pool.tokenB;

      // pool.data.tokenAPrice = pricesMap[pool.data.tokenA] || "0";
      // pool.data.tokenBPrice = pricesMap[pool.data.tokenB] || "0";
    });

    return poolData;
  } catch (error) {
    console.error("Error in getPools:", error);
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
