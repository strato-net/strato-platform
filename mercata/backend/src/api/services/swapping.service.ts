import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { poolFactory } from "../../config/config";
import { getInputPrice, getRequiredInput, calculateImpliedPrice, calculateLPFees24h, calculatePoolAPY, calculateLPTokenPrice, getRawPoolData } from "../helpers/swapping.helper";
import { getOraclePrices } from "./oracle.service";
import { SwapHistoryEntry } from "../../types";

const { poolSelectFields, Pool, PoolFactory, Token, PoolSwap, swapHistorySelectFields } = constants;

export const getPools = async (
  accessToken: string,
  userAddress: string | undefined,
  rawParams: Record<string, string | undefined> = {}
) => {
  const params = {
    ...Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ),
    select: rawParams.select || poolSelectFields.join(","),
    ...(rawParams.select || !userAddress
      ? {}
      : {
          "lpToken.balances.value": "gt.0",
          "lpToken.balances.key": `eq.${userAddress}`,
          "tokenA.balances.value": "gt.0",
          "tokenA.balances.key": `eq.${userAddress}`,
          "tokenB.balances.value": "gt.0",
          "tokenB.balances.key": `eq.${userAddress}`,
        }),
  };

  const poolData = await getRawPoolData(accessToken, params);

  // Extract token addresses for oracle price filtering
  const tokenAddresses = [...new Set([
    ...poolData.map((p: any) => p.tokenA?.address).filter(Boolean),
    ...poolData.map((p: any) => p.tokenB?.address).filter(Boolean)
  ])];

  // Fetch oracle prices for specific tokens
  const priceMap = await getOraclePrices(accessToken, {
    select: "asset:key,price:value::text",
    key: `in.(${tokenAddresses.join(',')})`
  });

  const poolAddresses = poolData.map((pool: any) => pool.address);
  const volumeMap = await getTradingVolume24hForPools(accessToken, poolAddresses, priceMap);
  
  return poolData.map((pool: any) => {
    const tokenAPrice = priceMap.get(pool.tokenA?.address) || "0";
    const tokenBPrice = priceMap.get(pool.tokenB?.address) || "0";
    
    const tokenAValue = (BigInt(pool.tokenABalance || "0") * BigInt(tokenAPrice)) / BigInt(10 ** 18);
    const tokenBValue = (BigInt(pool.tokenBBalance || "0") * BigInt(tokenBPrice)) / BigInt(10 ** 18);
    const totalLiquidityUSD = (tokenAValue + tokenBValue).toString();
    
    const lpTokenPrice = calculateLPTokenPrice(
      pool.tokenABalance || "0",
      pool.tokenBBalance || "0",
      tokenAPrice,
      tokenBPrice,
      pool.lpToken?._totalSupply || "0"
    );
    
    const tradingVolume24h = volumeMap.get(pool.address) || "0";
    const swapFeeRate = pool.swapFeeRate || 30;
    const lpSharePercent = pool.lpSharePercent || 7000;
    
    const fees24h = calculateLPFees24h(tradingVolume24h, swapFeeRate, lpSharePercent);
    const apy = calculatePoolAPY(fees24h, totalLiquidityUSD);
    
    // Calculate oracle exchange rate (A to B) with proper decimal precision
    const oracleAToBRatio = tokenAPrice !== "0" && tokenBPrice !== "0" 
      ? (Number(tokenAPrice) / Number(tokenBPrice)).toFixed(18)
      : "0";
    
    // Calculate oracle exchange rate (B to A) with proper decimal precision
    const oracleBToARatio = tokenAPrice !== "0" && tokenBPrice !== "0"
      ? (Number(tokenBPrice) / Number(tokenAPrice)).toFixed(18)
      : "0";
    
    // Extract user balance from balances array for each token
    const tokenABalance = pool.tokenA?.balances?.[0]?.balance || "0";
    const tokenBBalance = pool.tokenB?.balances?.[0]?.balance || "0";
    
    // Remove balances array and add direct balance property
    const { balances: tokenABalances, ...tokenARest } = pool.tokenA || {};
    const { balances: tokenBBalances, ...tokenBRest } = pool.tokenB || {};
    
    return {
      ...pool,
      tokenA: {
        ...tokenARest,
        balance: tokenABalance
      },
      tokenB: {
        ...tokenBRest,
        balance: tokenBBalance
      },
      tokenAPrice,
      tokenBPrice,
      lpTokenPrice,
      totalLiquidityUSD,
      tradingVolume24h,
      apy: apy.toFixed(2),
      oracleAToBRatio: oracleAToBRatio.toString(),
      oracleBToARatio: oracleBToARatio.toString()
    };
  });
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

    const pools = await getPools(accessToken, undefined, {
      address: "eq." + poolAddress,
      select: "tokenAAddress:tokenA,tokenBAddress:tokenB",
    });
    if (!pools || pools.length === 0) {
      throw new Error("No pools found for the given address");
    }
    const pool = pools[0];

    const tx = buildFunctionTx([
      {
        contractName: extractContractName(Token),
        contractAddress: pool.tokenAAddress || "",
        method: "approve",
        args: { spender: poolAddress || "", value: maxTokenAAmount || "" },
      },
      {
        contractName: extractContractName(Token),
        contractAddress: pool.tokenBAddress || "",
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

    const pools = await getPools(accessToken, undefined, {
      address: "eq." + poolAddress,
      select: "tokenAAddress:tokenA,tokenBAddress:tokenB",
    });
    if (!pools || pools.length === 0) {
      throw new Error("No pools found for the given address");
    }
    const pool = pools[0];

    const depositTokenAddress = isAToB ? pool.tokenAAddress : pool.tokenBAddress;
    
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

    const pools = await getPools(accessToken, undefined, {
      address: "eq." + poolAddress,
    });
    if (!pools || pools.length === 0) {
      throw new Error("No pools found for the given address");
    }
    const pool = pools[0];
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

    const pools = await getPools(accessToken, undefined, {
      address: "eq." + poolAddress,
      select: "tokenAAddress:tokenA,tokenBAddress:tokenB",
    });
    if (!pools || pools.length === 0) {
      throw new Error("No pools found for the given address");
    }
    const pool = pools[0];

    const token = isAToB ? pool.tokenAAddress : pool.tokenBAddress;

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

export const calculateSwap = async (
  accessToken: string,
  calculateSwapParams: {
    poolAddress: string;
    isAToB: boolean;
    amountIn: string;
  }
) => {
  const { poolAddress, isAToB, amountIn } = calculateSwapParams;
  
  const pools = await getPools(accessToken, undefined, {
    address: "eq." + poolAddress,
    select: "tokenABalance,tokenBBalance,swapFeeRate",
  });

  if (!pools || pools.length === 0) {
    throw new Error("No pools found for the given address");
  }

  const pool = pools[0];
  const fee = (BigInt(amountIn) * BigInt(pool.swapFeeRate)) / BigInt(10000);
  const netInput = BigInt(amountIn) - fee;
  const [inputReserve, outputReserve] = isAToB 
    ? [BigInt(pool.tokenABalance), BigInt(pool.tokenBBalance)]
    : [BigInt(pool.tokenBBalance), BigInt(pool.tokenABalance)];

  return getInputPrice(netInput, inputReserve, outputReserve);
};

export const calculateSwapReverse = async (
  accessToken: string,
  calculateSwapReverseParams: {
    poolAddress: string;
    isAToB: boolean;
    amountIn: string;
  }
) => {
  const { poolAddress, isAToB, amountIn } = calculateSwapReverseParams;
  
  const pools = await getPools(accessToken, undefined, {
    address: "eq." + poolAddress,
    select: "tokenABalance,tokenBBalance",
  });

  if (!pools || pools.length === 0) {
    throw new Error("No pools found for the given address");
  }

  const pool = pools[0];
  const [inputReserve, outputReserve] = isAToB 
    ? [BigInt(pool.tokenABalance), BigInt(pool.tokenBBalance)]
    : [BigInt(pool.tokenBBalance), BigInt(pool.tokenABalance)];

  return getRequiredInput(BigInt(amountIn), inputReserve, outputReserve);
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
    
    // Verify the pool exists
    const pools = await getPools(accessToken, undefined, {
      address: "eq." + poolAddress,
      select: "address,_owner",
    });
    if (!pools || pools.length === 0) {
      throw new Error("No pools found for the given address");
    }

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
