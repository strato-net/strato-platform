import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { poolFactory } from "../../config/config";
import { 
  calculateImpliedPrice,
  getRawPoolData,
  buildPoolParams,
  extractTokenAddresses,
  calculatePoolMetrics,
  calculateOracleRatios,
  buildSwapToken,
  buildLPToken
} from "../helpers/swapping.helper";
import { getOraclePrices } from "./oracle.service";
import { SwapHistoryEntry, PoolList } from "../../types/swaps";

const { Pool, PoolFactory, Token, PoolSwap, swapHistorySelectFields } = constants;

export const getPools = async (
  accessToken: string,
  userAddress: string | undefined,
  rawParams: Record<string, string | undefined> = {}
): Promise<PoolList> => {
  const params = buildPoolParams(rawParams, userAddress);

  const [poolData, { data: factoryData }] = await Promise.all([
    getRawPoolData(accessToken, params),
    cirrus.get(accessToken, `/${constants.PoolFactory}`, {
      params: { address: "eq." + poolFactory, select: "swapFeeRate,lpSharePercent" }
    })
  ]);

  const tokenAddresses = extractTokenAddresses(poolData);
  const [priceMap, volumeMap] = await Promise.all([
    getOraclePrices(accessToken, {
      select: "asset:key,price:value::text",
      key: `in.(${tokenAddresses.join(',')})`
    }),
    getTradingVolume24hForPools(accessToken, poolData.map((p: any) => p.address), new Map())
  ]);
  
  return poolData.map((pool: any) => {
    const tokenAPrice = priceMap.get(pool.tokenA?.address) || "0";
    const tokenBPrice = priceMap.get(pool.tokenB?.address) || "0";
    const volume24h = volumeMap.get(pool.address) || "0";
    
    const { totalLiquidityUSD, apy, lpTokenPrice, swapFeeRate, lpSharePercent } = 
      calculatePoolMetrics(pool, tokenAPrice, tokenBPrice, volume24h, factoryData?.[0]);
    
    const { aToB: oracleAToBRatio, bToA: oracleBToARatio } = 
      calculateOracleRatios(tokenAPrice, tokenBPrice);
    
    const tokenABalance = pool.tokenA?.balances?.[0]?.balance || "0";
    const tokenBBalance = pool.tokenB?.balances?.[0]?.balance || "0";
    const lpTokenBalance = pool.lpToken?.balances?.[0]?.balance || "0";
    
    const symbolA = pool.tokenA?._symbol || "Unknown";
    const symbolB = pool.tokenB?._symbol || "Unknown";
    
    return {
      address: pool.address,
      poolName: `${symbolA}-${symbolB}`,
      poolSymbol: `${symbolA}-${symbolB}`,
      tokenA: buildSwapToken(pool.tokenA, tokenAPrice, pool.tokenABalance || "0", tokenABalance),
      tokenB: buildSwapToken(pool.tokenB, tokenBPrice, pool.tokenBBalance || "0", tokenBBalance),
      lpToken: buildLPToken(pool.lpToken, lpTokenPrice, lpTokenBalance),
      totalLiquidityUSD,
      tradingVolume24h: volume24h,
      apy: apy.toFixed(2),
      aToBRatio: pool.aToBRatio || "0",
      bToARatio: pool.bToARatio || "0",
      oracleAToBRatio,
      oracleBToARatio,
      swapFeeRate,
      lpSharePercent,
    };
  });
};

export const getSwapableTokens = async (
  accessToken: string,
  userAddress: string
) => {
  const poolData = await getRawPoolData(accessToken, {
    select: `tokenA:tokenA_fkey(address,_name,_symbol,balances:${Token}-_balances(user:key,balance:value::text)),tokenB:tokenB_fkey(address,_name,_symbol,balances:${Token}-_balances(user:key,balance:value::text))`,
    "tokenA.balances.key": `eq.${userAddress}`,
    "tokenB.balances.key": `eq.${userAddress}`,
  });

  const tokenMap = new Map();
  
  poolData.forEach((pool: any) => {
    [pool.tokenA, pool.tokenB].forEach((token: any) => {
      if (!tokenMap.has(token.address)) {
        tokenMap.set(token.address, {
          address: token.address,
          _name: token._name,
          _symbol: token._symbol,
          balance: token.balances?.[0]?.balance || "0"
        });
      }
    });
  });

  return Array.from(tokenMap.values());
};

export const getSwapableTokenPairs = async (
  accessToken: string,
  tokenAddress: string,
  userAddress: string
) => {
  const [poolDataA, poolDataB] = await Promise.all([
    getRawPoolData(accessToken, {
      select: `tokenB:tokenB_fkey(address,_name,_symbol,balances:${Token}-_balances(user:key,balance:value::text))`,
      tokenA: "eq." + tokenAddress,
      "tokenB.balances.key": `eq.${userAddress}`,
    }),
    getRawPoolData(accessToken, {
      select: `tokenA:tokenA_fkey(address,_name,_symbol,balances:${Token}-_balances(user:key,balance:value::text))`,
      tokenB: "eq." + tokenAddress,
      "tokenA.balances.key": `eq.${userAddress}`,
    })
  ]);

  const tokens = [
    ...poolDataA.map((pool: any) => pool.tokenB),
    ...poolDataB.map((pool: any) => pool.tokenA),
  ].filter(Boolean);

  const tokenMap = new Map();
  tokens.forEach((token: any) => {
    if (!tokenMap.has(token.address)) {
        tokenMap.set(token.address, {
          address: token.address,
          _name: token._name,
          _symbol: token._symbol,
          balance: token.balances?.[0]?.balance || "0"
        });
    }
  });

  return Array.from(tokenMap.values());
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
    throw error;
  }
};

export const addLiquidityDualToken = async (
  accessToken: string,
  params: {
    poolAddress: string;
    tokenBAmount: string;
    maxTokenAAmount: string;
    deadline: number;
  }
) => {
  try {
    const { poolAddress, tokenBAmount, maxTokenAAmount, deadline } = params;

    const poolData = await getRawPoolData(accessToken, {
      address: "eq." + poolAddress,
      select: "tokenA,tokenB",
    });
    if (!poolData || poolData.length === 0) {
      throw new Error("No pools found for the given address");
    }
    const pool = poolData[0];

    const tx = buildFunctionTx([
      {
        contractName: extractContractName(Token),
        contractAddress: pool.tokenA || "",
        method: "approve",
        args: { spender: poolAddress || "", value: maxTokenAAmount || "" },
      },
      {
        contractName: extractContractName(Token),
        contractAddress: pool.tokenB || "",
        method: "approve",
        args: { spender: poolAddress || "", value: tokenBAmount || "" },
      },
      {
        contractName: extractContractName(Pool),
        contractAddress: poolAddress || "",
        method: "addLiquidity",
        args: {
          tokenBAmount,
          maxTokenAAmount,
          deadline
        },
      }
    ]);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error) {
    throw error;
  }
};

export const addLiquiditySingleToken = async (
  accessToken: string,
  params: {
    poolAddress: string;
    singleTokenAmount: string;
    isAToB: boolean;
    deadline: number;
  }
) => {
  try {
    const { poolAddress, singleTokenAmount, isAToB, deadline } = params;

    const poolData = await getRawPoolData(accessToken, {
      address: "eq." + poolAddress,
      select: "tokenA,tokenB",
    });
    if (!poolData || poolData.length === 0) {
      throw new Error("No pools found for the given address");
    }
    const pool = poolData[0];

    const depositTokenAddress = isAToB ? pool.tokenA : pool.tokenB;
    
    const tx = buildFunctionTx([
      {
        contractName: extractContractName(Token),
        contractAddress: depositTokenAddress || "",
        method: "approve",
        args: { spender: poolAddress || "", value: singleTokenAmount || "" },
      },
      {
        contractName: extractContractName(Pool),
        contractAddress: poolAddress || "",
        method: "addLiquiditySingleToken",
        args: {
          isAToB,
          amountIn: singleTokenAmount,
          deadline
        },
      }
    ]);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error) {
    throw error;
  }
};

export const removeLiquidity = async (
  accessToken: string,
  removeLiquidityParams: {
    poolAddress: string;
    lpTokenAmount: string;
    deadline: number;
  }
) => {
  try {
    const { poolAddress, lpTokenAmount, deadline } = removeLiquidityParams;

    const poolData = await getRawPoolData(accessToken, {
      address: "eq." + poolAddress,
      select: "tokenABalance,tokenBBalance,lpToken:lpToken_fkey(_totalSupply)",
    });
    if (!poolData || poolData.length === 0) {
      throw new Error("No pools found for the given address");
    }
    const pool = poolData[0];
    // calculate tokenA and tokenB amounts
    const tokenAAmount =
      (BigInt(pool.tokenABalance) * BigInt(lpTokenAmount || "0")) /
      BigInt(pool.lpToken._totalSupply);
    const tokenBAmount =
      (BigInt(pool.tokenBBalance) * BigInt(lpTokenAmount || "0")) /
      BigInt(pool.lpToken._totalSupply);
    // Apply 1% slippage tolerance
    const slippageFactor = BigInt(99); // 99%
    const minTokenAAmount = (
      (tokenAAmount * slippageFactor) /
      BigInt(100)
    ).toString();
    const minTokenBAmount = (
      (tokenBAmount * slippageFactor) /
      BigInt(100)
    ).toString();
    const tx = buildFunctionTx({
      contractName: extractContractName(Pool),
      contractAddress: poolAddress || "",
      method: "removeLiquidity",
      args: {
        lpTokenAmount,
        minTokenBAmount,
        minTokenAAmount,
        deadline
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
    throw error;
  }
};

export const swap = async (
  accessToken: string,
  swapParams: {
    poolAddress: string;
    isAToB: boolean;
    amountIn: string;
    minAmountOut: string;
    deadline: number;
  }
) => {
  try {
    const { poolAddress, isAToB, amountIn, minAmountOut, deadline } = swapParams;

    const poolData = await getRawPoolData(accessToken, {
      address: "eq." + poolAddress,
      select: "tokenA,tokenB",
    });
    if (!poolData || poolData.length === 0) {
      throw new Error("No pools found for the given address");
    }
    const pool = poolData[0];

    const token = isAToB ? pool.tokenA : pool.tokenB;

    const tx = buildFunctionTx([
      {
        contractName: extractContractName(Token),
        contractAddress: token || "",
        method: "approve",
        args: { spender: poolAddress || "", value: amountIn || "" },
      },
      {
        contractName: extractContractName(Pool),
        contractAddress: poolAddress || "",
        method: "swap",
        args: {
          isAToB,
          amountIn,
          minAmountOut,
          deadline,
        },
      }
    ]);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error) {
    throw error;
  }
};

export const getTradingVolume24hForPools = async (
  accessToken: string,
  poolAddresses: string[],
  priceMap: Map<string, string>
): Promise<Map<string, string>> => {
  if (poolAddresses.length === 0) {
    return new Map();
  }

  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const timestamp24hAgo = oneDayAgo.toISOString();
  
  const params = {
    select: swapHistorySelectFields.join(","),
    address: `in.(${poolAddresses.join(',')})`,
    block_timestamp: `gte.${timestamp24hAgo}`,
  };

  const { data: swapHistory } = await cirrus.get(accessToken, `/${PoolSwap}`, {
    params,
  });

  const volumeMap = new Map<string, number>();
  poolAddresses.forEach(address => volumeMap.set(address, 0));

  swapHistory.forEach(({ address: poolAddress, tokenIn, amountIn }: any) => {
    const priceStr = priceMap.get(tokenIn);
    const amount = parseFloat(amountIn || "0");
    const price = parseFloat(priceStr || "0");

    if (!volumeMap.has(poolAddress) || price === 0 || amount === 0) return;

    const volumeUSD = (amount * price) / 1e18;
    volumeMap.set(poolAddress, (volumeMap.get(poolAddress) || 0) + volumeUSD);
  });

  const result = new Map<string, string>();
  volumeMap.forEach((volume, address) => {
    result.set(address, volume.toString());
  });

  return result;
};

export const getSwapHistory = async (
  accessToken: string,
  poolAddress: string,
  rawParams: Record<string, string | undefined> = {}
): Promise<{ data: SwapHistoryEntry[], totalCount: number }> => {
  try {
    const params = {
      address: `eq.${poolAddress}`,
      select: rawParams.select || swapHistorySelectFields.join(','),
      order: rawParams.order || 'block_timestamp.desc',
      ...Object.fromEntries(
        Object.entries(rawParams).filter(([key, value]) => 
          value !== undefined && 
          !['select', 'order'].includes(key)
        )
      )
    };

    const [swapEventsResponse, countResponse] = await Promise.all([
      cirrus.get(accessToken, `/${PoolSwap}`, { params }),
      cirrus.get(accessToken, `/${PoolSwap}`, { 
        params: { address: `eq.${poolAddress}`, select: 'id.count()' }
      })
    ]);

    const swapEvents = swapEventsResponse.data;
    const totalCount = countResponse.data?.[0]?.count || 0;

    if (!Array.isArray(swapEvents)) {
      return { data: [], totalCount: 0 };
    }

    const swapHistory = swapEvents.map((event: any) => {
      const { tokenA, tokenB } = event.pool;
      const isAToB = event.tokenIn === tokenA.address;
      
      return {
        id: event.id.toString(),
        timestamp: new Date(event.block_timestamp),
        tokenIn: isAToB ? tokenA.symbol : tokenB.symbol,
        tokenOut: isAToB ? tokenB.symbol : tokenA.symbol,
        amountIn: event.amountIn,
        amountOut: event.amountOut,
        impliedPrice: calculateImpliedPrice(event.amountIn, event.amountOut, isAToB),
        sender: event.sender
      };
    });

    return { data: swapHistory, totalCount };
  } catch (error) {
    console.error('Error fetching swap history:', error);
    throw new Error('Failed to fetch swap history');
  }
};

export const setPoolRates = async (
  accessToken: string,
  setPoolRatesParams: {
    poolAddress: string;
    swapFeeRate: number;
    lpSharePercent: number;
  }
) => {
  try {
    const { poolAddress, swapFeeRate, lpSharePercent } = setPoolRatesParams;

    // Call setPoolFeeParameters on PoolFactory instead of calling Pool directly
    const tx = buildFunctionTx({
      contractName: extractContractName(PoolFactory),
      contractAddress: poolFactory,
      method: "setPoolFeeParameters",
      args: {
        poolAddress: poolAddress,
        newSwapFeeRate: swapFeeRate.toString(),
        newLpSharePercent: lpSharePercent.toString(),
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
    throw error;
  }
};
