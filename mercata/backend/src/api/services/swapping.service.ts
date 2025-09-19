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
import { 
  safeBigInt, 
  validatePositiveBigInt, 
  safeBigIntDivide, 
  applySlippageTolerance,
} from "../../utils/bigIntUtils";
import { 
  SwapHistoryEntry, 
  PoolList, 
  SwapParams,
  LiquidityParams,
  RemoveLiquidityParams,
  SingleTokenLiquidityParams,
  SetPoolRatesParams,
  CreatePoolParams,
  TransactionResponse,
  SwapHistoryResponse,
  SwapToken,
  RawPool,
  RawToken,
  RawPoolFactory,
  RawSwapEvent,
  isRawPool,
  isRawToken,
  isRawSwapEvent
} from "../../types/swaps";

const { Pool, PoolFactory, Token, PoolSwap, swapHistorySelectFields, swapTokenSelectFields } = constants;

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

  if (!Array.isArray(poolData)) {
    throw new Error("Invalid pool data received from API");
  }

  const tokenAddresses = extractTokenAddresses(poolData);
  const [priceMap, volumeMap] = await Promise.all([
    getOraclePrices(accessToken, {
      select: "asset:key,price:value::text",
      key: `in.(${tokenAddresses.join(',')})`
    }),
    getTradingVolume24hForPools(accessToken, poolData.map((pool: RawPool) => pool?.address).filter(Boolean), new Map())
  ]);
  
  return poolData.map((pool: RawPool) => {
    if (!isRawPool(pool)) {
      throw new Error(`Invalid pool data structure for pool ${(pool as any)?.address || 'unknown'}`);
    }

    const tokenAPrice = priceMap.get(pool.tokenA?.address) || "0";
    const tokenBPrice = priceMap.get(pool.tokenB?.address) || "0";
    const volume24h = volumeMap.get(pool.address) || "0";
    
    const factoryDataTyped = factoryData?.[0] as RawPoolFactory | undefined;
    const { totalLiquidityUSD, apy, lpTokenPrice, swapFeeRate, lpSharePercent } = 
      calculatePoolMetrics(pool, tokenAPrice, tokenBPrice, volume24h, factoryDataTyped);
    
    const { aToB: oracleAToBRatio, bToA: oracleBToARatio } = 
      calculateOracleRatios(tokenAPrice, tokenBPrice);
    
    const tokenABalance = pool.tokenA?.balances?.[0]?.value || "0";
    const tokenBBalance = pool.tokenB?.balances?.[0]?.value || "0";
    const lpTokenBalance = pool.lpToken?.balances?.[0]?.value || "0";
    
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
): Promise<SwapToken[]> => {
  const poolData = await getRawPoolData(accessToken, {
    select: `tokenA:tokenA_fkey(${swapTokenSelectFields.join(',')}),tokenB:tokenB_fkey(${swapTokenSelectFields.join(',')}),tokenABalance::text,tokenBBalance::text`,
    "tokenA.balances.key": `eq.${userAddress}`,
    "tokenB.balances.key": `eq.${userAddress}`,
  });

  if (!Array.isArray(poolData)) {
    throw new Error("Invalid pool data received from API");
  }

  const tokenAddresses = extractTokenAddresses(poolData);
  const priceMap = await getOraclePrices(accessToken, {
    select: "asset:key,price:value::text",
    key: `in.(${tokenAddresses.join(',')})`
  });

  const tokenMap = new Map<string, SwapToken>();
  
  poolData.forEach((pool: RawPool) => {
    if (!isRawPool(pool)) {
      throw new Error(`Invalid pool data structure for pool ${(pool as any)?.address || 'unknown'}`);
    }

    [pool.tokenA, pool.tokenB].forEach((token: RawToken, index: number) => {
      if (!isRawToken(token)) {
        throw new Error(`Invalid token data structure for token ${(token as any)?.address || 'unknown'}`);
      }

      if (!tokenMap.has(token.address)) {
        const price = priceMap.get(token.address) || "0";
        const poolBalance = index === 0 ? pool.tokenABalance || "0" : pool.tokenBBalance || "0";
        
        tokenMap.set(token.address, {
          address: token.address,
          _name: token._name,
          _symbol: token._symbol,
          customDecimals: token.customDecimals || 18,
          _totalSupply: token._totalSupply || "0",
          balance: token.balances?.[0]?.value || "0",
          price,
          poolBalance
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
): Promise<SwapToken[]> => {
  const [poolDataA, poolDataB] = await Promise.all([
    getRawPoolData(accessToken, {
      select: `tokenB:tokenB_fkey(${swapTokenSelectFields.join(',')}),tokenBBalance::text`,
      tokenA: "eq." + tokenAddress,
      "tokenB.balances.key": `eq.${userAddress}`,
    }),
    getRawPoolData(accessToken, {
      select: `tokenA:tokenA_fkey(${swapTokenSelectFields.join(',')}),tokenABalance::text`,
      tokenB: "eq." + tokenAddress,
      "tokenA.balances.key": `eq.${userAddress}`,
    })
  ]);

  if (!Array.isArray(poolDataA) || !Array.isArray(poolDataB)) {
    throw new Error("Invalid pool data received from API");
  }

  const allTokens: Array<{token: RawToken, poolBalance: string}> = [
    ...poolDataA.map((pool: RawPool) => ({ token: pool.tokenB, poolBalance: pool.tokenBBalance || "0" })).filter(item => isRawToken(item.token)),
    ...poolDataB.map((pool: RawPool) => ({ token: pool.tokenA, poolBalance: pool.tokenABalance || "0" })).filter(item => isRawToken(item.token)),
  ];

  const tokenAddresses = allTokens.map(item => item.token.address);
  const priceMap = await getOraclePrices(accessToken, {
    select: "asset:key,price:value::text",
    key: `in.(${tokenAddresses.join(',')})`
  });

  const tokenMap = new Map<string, SwapToken>();
  
  allTokens.forEach(({token, poolBalance}) => {
    if (!tokenMap.has(token.address)) {
      const price = priceMap.get(token.address) || "0";
      tokenMap.set(token.address, {
        address: token.address,
        _name: token._name,
        _symbol: token._symbol,
        customDecimals: token.customDecimals || 18,
        _totalSupply: token._totalSupply || "0",
        balance: token.balances?.[0]?.value || "0",
        price,
        poolBalance
      });
    }
  });

  return Array.from(tokenMap.values());
};

export const createPool = async (
  accessToken: string,
  body: CreatePoolParams
): Promise<TransactionResponse> => {
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
  params: LiquidityParams
): Promise<TransactionResponse> => {
  try {
    const { poolAddress, tokenBAmount, maxTokenAAmount, deadline } = params;

    const poolData = await getRawPoolData(accessToken, {
      address: "eq." + poolAddress,
      select: "tokenA,tokenB"
    });
    
    if (!Array.isArray(poolData) || poolData.length === 0) {
      throw new Error("No pools found for the given address");
    }
    
    const pool = poolData[0] as unknown as { tokenA: string; tokenB: string };
    if (typeof pool.tokenA !== 'string' || typeof pool.tokenB !== 'string') {
      throw new Error(`Invalid pool data structure for pool ${poolAddress}`);
    }

    const tx = buildFunctionTx([
      {
        contractName: extractContractName(Token),
        contractAddress: pool.tokenA,
        method: "approve",
        args: { spender: poolAddress, value: maxTokenAAmount },
      },
      {
        contractName: extractContractName(Token),
        contractAddress: pool.tokenB,
        method: "approve",
        args: { spender: poolAddress, value: tokenBAmount },
      },
      {
        contractName: extractContractName(Pool),
        contractAddress: poolAddress,
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
  params: SingleTokenLiquidityParams
): Promise<TransactionResponse> => {
  try {
    const { poolAddress, singleTokenAmount, isAToB, deadline } = params;

    const poolData = await getRawPoolData(accessToken, {
      address: "eq." + poolAddress,
      select: "tokenA,tokenB"
    });
    
    if (!Array.isArray(poolData) || poolData.length === 0) {
      throw new Error("No pools found for the given address");
    }
    
    const pool = poolData[0] as unknown as { tokenA: string; tokenB: string };
    if (typeof pool.tokenA !== 'string' || typeof pool.tokenB !== 'string') {
      throw new Error(`Invalid pool data structure for pool ${poolAddress}`);
    }

    const depositTokenAddress = isAToB ? pool.tokenA : pool.tokenB;
    
    const tx = buildFunctionTx([
      {
        contractName: extractContractName(Token),
        contractAddress: depositTokenAddress,
        method: "approve",
        args: { spender: poolAddress, value: singleTokenAmount },
      },
      {
        contractName: extractContractName(Pool),
        contractAddress: poolAddress,
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
  removeLiquidityParams: RemoveLiquidityParams
): Promise<TransactionResponse> => {
  try {
    const { poolAddress, lpTokenAmount, deadline } = removeLiquidityParams;

    const poolData = await getRawPoolData(accessToken, {
      address: "eq." + poolAddress,
      select: "tokenABalance,tokenBBalance,lpToken:lpToken_fkey(_totalSupply)",
    });
    
    if (!Array.isArray(poolData) || poolData.length === 0) {
      throw new Error("No pools found for the given address");
    }
    
    const pool = poolData[0] as unknown as { 
      tokenABalance: string; 
      tokenBBalance: string; 
      lpToken: { _totalSupply: string } 
    };
    if (typeof pool.tokenABalance !== 'string' || typeof pool.tokenBBalance !== 'string' || !pool.lpToken?._totalSupply) {
      throw new Error(`Invalid pool data structure for pool ${poolAddress}`);
    }

    // Calculate tokenA and tokenB amounts
    const tokenABalance = safeBigInt(pool.tokenABalance || "0");
    const tokenBBalance = safeBigInt(pool.tokenBBalance || "0");
    const lpTokenSupply = safeBigInt(pool.lpToken._totalSupply || "0");
    const lpTokenAmountBigInt = safeBigInt(lpTokenAmount);

    validatePositiveBigInt(lpTokenSupply, "LP token supply");
    validatePositiveBigInt(lpTokenAmountBigInt, "LP token amount");

    const tokenAAmount = safeBigIntDivide(tokenABalance * lpTokenAmountBigInt, lpTokenSupply, "Token A amount calculation");
    const tokenBAmount = safeBigIntDivide(tokenBBalance * lpTokenAmountBigInt, lpTokenSupply, "Token B amount calculation");
    
    // Apply 1% slippage tolerance (99 basis points)
    const minTokenAAmount = applySlippageTolerance(tokenAAmount, 100).toString();
    const minTokenBAmount = applySlippageTolerance(tokenBAmount, 100).toString();
    
    const tx = buildFunctionTx({
      contractName: extractContractName(Pool),
      contractAddress: poolAddress,
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
  swapParams: SwapParams
): Promise<TransactionResponse> => {
  try {
    const { poolAddress, isAToB, amountIn, minAmountOut, deadline } = swapParams;

    const poolData = await getRawPoolData(accessToken, {
      address: "eq." + poolAddress,
      select: "tokenA,tokenB"
    });
    
    if (!Array.isArray(poolData) || poolData.length === 0) {
      throw new Error("No pools found for the given address");
    }
    
    const pool = poolData[0] as unknown as { tokenA: string; tokenB: string };
    if (typeof pool.tokenA !== 'string' || typeof pool.tokenB !== 'string') {
      throw new Error(`Invalid pool data structure for pool ${poolAddress}`);
    }

    const tokenAddress = isAToB ? pool.tokenA : pool.tokenB;

    const tx = buildFunctionTx([
      {
        contractName: extractContractName(Token),
        contractAddress: tokenAddress,
        method: "approve",
        args: { spender: poolAddress, value: amountIn },
      },
      {
        contractName: extractContractName(Pool),
        contractAddress: poolAddress,
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

  if (!Array.isArray(swapHistory)) {
    throw new Error("Invalid swap history data received from API");
  }

  const volumeMap = new Map<string, number>();
  poolAddresses.forEach(address => volumeMap.set(address, 0));

  swapHistory.forEach((swapEvent: RawSwapEvent) => {
    if (!isRawSwapEvent(swapEvent)) {
      console.warn(`Invalid swap event data: ${JSON.stringify(swapEvent)}`);
      return;
    }

    const { address: poolAddress, tokenIn, amountIn } = swapEvent;
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
): Promise<SwapHistoryResponse> => {
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

    const swapHistory: SwapHistoryEntry[] = swapEvents.map((event: RawSwapEvent) => {
      if (!isRawSwapEvent(event)) {
        throw new Error(`Invalid swap event data structure: ${JSON.stringify(event)}`);
      }

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
  setPoolRatesParams: SetPoolRatesParams
): Promise<TransactionResponse> => {
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
