import { cirrus, strato, bloc } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { getInputPrice } from "../helpers/swapping.helper";
import { approveAsset } from "../helpers/tokens.helper";
import { getPools as getLendingPool } from "./lending.service";

const Pool = "ERC20";
const PoolFactory = "PoolFactory";

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

    // Fetch metadata for all unique token addresses in pools, defaulting missing to empty string
    const tokenAddresses = Array.from(
      new Set(
        poolData.flatMap((pool) =>
          pool.data
            ? [pool.data.tokenA ?? "", pool.data.tokenB ?? ""]
            : []
        )
      )
    ).filter((addr) => addr);

    const tokenMetaResponse = await cirrus.get(
      accessToken,
      `/BlockApps-Mercata-ERC20`,
      {
        params: {
          address: `in.(${tokenAddresses.join(",")})`,
          select: "address,_name,_symbol",
        },
      }
    );

    if (
      tokenMetaResponse.status !== 200 ||
      !Array.isArray(tokenMetaResponse.data)
    ) {
      throw new Error("Error fetching token metadata from Cirrus");
    }

    const tokenMetaMap = tokenMetaResponse.data.reduce((map, token) => {
      map[token.address] = {
        name: token._name ?? "",
        symbol: token._symbol ?? "",
      };
      return map;
    }, {} as Record<string, { name: string; symbol: string }>);

    // Attach name and symbol to each pool object
    poolData.forEach((pool) => {
      if (!pool.data) return;
      const tokenA = pool.data.tokenA ?? "";
      const tokenB = pool.data.tokenB ?? "";
      const metaA = tokenMetaMap[tokenA] || { name: "", symbol: "" };
      const metaB = tokenMetaMap[tokenB] || { name: "", symbol: "" };
      pool.data.tokenAName = metaA.name;
      pool.data.tokenASymbol = metaA.symbol;
      pool.data.tokenBName = metaB.name;
      pool.data.tokenBSymbol = metaB.symbol;
    });

    // Fetch lending pool info to get oracle address
    const lendingInfo = await getLendingPool(accessToken);
    const oracleAddress = lendingInfo.oracle;

    // Fetch latest prices from oracle contract
    const priceResponse = await bloc.get(
      accessToken,
      StratoPaths.state.replace(":contractAddress", oracleAddress)
    );
    if (
      priceResponse.status !== 200 ||
      !priceResponse.data ||
      !priceResponse.data?.prices
    ) {
      throw new Error("Error fetching prices from PriceOracle");
    }
    const pricesMap: Record<string, string> = priceResponse.data.prices;

    // Attach price to each pool object
    poolData.forEach((pool) => {
      if (!pool.data) return;
      const tokenA = pool.data.tokenA ?? "";
      const tokenB = pool.data.tokenB ?? "";
      pool.data.tokenAPrice = pricesMap[tokenA] || "0";
      pool.data.tokenBPrice = pricesMap[tokenB] || "0";
    });

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

    await approveAsset(
      accessToken,
      pool[0].tokenA || "",
      body.address || "",
      body.max_tokenA_amount || ""
    );

    await approveAsset(
      accessToken,
      pool[0].tokenB || "",
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
