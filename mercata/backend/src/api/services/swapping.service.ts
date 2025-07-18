import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { getInputPrice, getRequiredInput, calculateImpliedPrice, calculateLPFees24h, calculatePoolAPR } from "../helpers/swapping.helper";
import { getPool as getLendingRegistry } from "./lending.service";
import { SwapHistoryEntry } from "../../types";

const { poolSelectFields, Pool, PoolFactory, Token, PriceOracle, PoolSwap, swapHistorySelectFields } = constants;

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
          "lpToken.balances.key": `eq.${address}`,
          "tokenA.balances.value": "gt.0",
          "tokenA.balances.key": `eq.${address}`,
          "tokenB.balances.value": "gt.0",
          "tokenB.balances.key": `eq.${address}`,
        }),
      _owner: "eq." + constants.poolFactory,
  };

  // DEBUG: log Cirrus query parameters to verify filters
  if (process.env.DEBUG_GET_POOLS === 'true') {
    console.log('[getPools] params →', params);
  }

  const { data: poolData } = await cirrus.get(accessToken, `/${Pool}`, {
    params,
  });

  // Fetch oracle prices
  const { oracle: { prices } } = await getLendingRegistry(accessToken, undefined, {
    select: `oracle:priceOracle_fkey(address,prices:${PriceOracle}-prices(key,value::text))`,
  });
  
  const priceMap = new Map<string, string>(
    Array.isArray(prices) 
      ? prices
          .map((p: any) => [p.key, p.value])
          .filter(([key, value]) => key && typeof value === 'string') as [string, string][]
      : []
  );

  const poolAddresses = poolData.map((pool: any) => pool.address);
  const volumeMap = await getTradingVolume24hForPools(accessToken, poolAddresses, priceMap);
  
  return poolData.map((pool: any) => {
    const tokenAPrice = priceMap.get(pool.tokenA?.address) || "0";
    const tokenBPrice = priceMap.get(pool.tokenB?.address) || "0";
    const lpTokenPrice = priceMap.get(pool.lpToken?.address) || "0";
    
    const tokenAValue = (BigInt(pool.tokenABalance || "0") * BigInt(tokenAPrice)) / BigInt(10 ** 18);
    const tokenBValue = (BigInt(pool.tokenBBalance || "0") * BigInt(tokenBPrice)) / BigInt(10 ** 18);
    const totalLiquidityUSD = (tokenAValue + tokenBValue).toString();
    
    const tradingVolume24h = volumeMap.get(pool.address) || "0";
    const swapFeeRate = pool.swapFeeRate || 30;
    const lpSharePercent = pool.lpSharePercent || 7000;
    
    const fees24h = calculateLPFees24h(tradingVolume24h, swapFeeRate, lpSharePercent);
    const apr = calculatePoolAPR(fees24h, totalLiquidityUSD);
    
    return {
      ...pool,
      tokenAPrice,
      tokenBPrice,
      lpTokenPrice,
      totalLiquidityUSD,
      tradingVolume24h,
      apr: apr.toFixed(2)
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

export const addLiquidity = async (
  accessToken: string,
  params: {
    poolAddress: string;
    tokenBAmount: string;
    maxTokenAAmount: string;
  }
) => {
  try {
    const { poolAddress, tokenBAmount, maxTokenAAmount } = params;
    
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
  }
) => {
  try {
    const { poolAddress, lpTokenAmount } = removeLiquidityParams;
    
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
  }
) => {
  try {
    const { poolAddress, isAToB, amountIn, minAmountOut } = swapParams;
    
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
