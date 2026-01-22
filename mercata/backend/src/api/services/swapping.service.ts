import { cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { executeTransaction } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { constants } from "../../config/constants";
import * as config from "../../config/config";
import {
  calculateImpliedPrice,
  buildPoolParams,
  extractTokenAddresses,
  extractTokenAddressesFromTokens,
  buildSwapToken,
  buildPoolList,
  fetchPoolTokenAddresses,
  fetchPoolBalances,
  fetchLPTokenAddress,
  buildTokenApprovalTx,
  getTradingVolume24hForPools,
  getTokenBalance,
  stakeNewLPTokens
} from "../helpers/swapping.helper";
import { getOraclePrices } from "./oracle.service";
import { getPools as getRewardsChefPools } from "./rewardsChef.service";
import { getStakedBalance, findPoolByLpToken } from "../helpers/rewards/rewardsChef.helpers";
import { getTokenBalanceForUser } from "./tokens.service";
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
  RawToken,
  RawGetPool,
  RawPoolFactory,
  RawSwapEvent,
  PoolWithTokens,
  PoolWithTokenA,
  PoolWithTokenB
} from "@mercata/shared-types";

const { Pool, PoolFactory, PoolSwap, swapHistorySelectFields, swapTokenSelectFields } = constants;

// ============================================================================
// READ OPERATIONS
// ============================================================================

// --- Pool Queries ---

export const getPools = async (
  accessToken: string,
  userAddress: string | undefined,
  rawParams: Record<string, string | undefined> = {}
): Promise<PoolList> => {
  const params = buildPoolParams(rawParams, userAddress);

  const [{data: poolData}, { data: factoryData }] = await Promise.all([
    cirrus.get(accessToken, `/${Pool}`, { params }),
    cirrus.get(accessToken, `/${PoolFactory}`, {
      params: { address: "eq." + config.poolFactory, select: "swapFeeRate,lpSharePercent" }
    })
  ]);

  // Filter out hidden pools
  const validatedPools = (poolData as RawGetPool[]).filter(
    pool => !config.hiddenSwapPools.has(pool.address)
  );
  const validatedFactory = factoryData[0] as RawPoolFactory;
  const tokenAddresses = extractTokenAddresses(validatedPools);
  const priceMap = await getOraclePrices(accessToken, {
    select: "asset:key,price:value::text",
    key: `in.(${tokenAddresses.join(',')})`
  });
  const volumeMap = await getTradingVolume24hForPools(accessToken, validatedPools.map(pool => pool.address), priceMap);

  // Fetch staked balances from RewardsChef if userAddress is provided
  let stakedBalanceMap: Map<string, string> | undefined;
  if (userAddress) {
    // Get all RewardsChef pools
    const rewardsChefPools = await getRewardsChefPools(accessToken, config.rewardsChef);

    // Build a map of lpToken address -> rewards pool index
    const lpTokenToPoolIdx = new Map<string, number>();
    rewardsChefPools.forEach(pool => {
      lpTokenToPoolIdx.set(pool.lpToken, pool.poolIdx);
    });

    // For each swap pool, check if it has a matching rewards pool and get staked balance
    stakedBalanceMap = new Map<string, string>();
    await Promise.all(
      validatedPools.map(async (pool) => {
        const poolIdx = lpTokenToPoolIdx.get(pool.lpToken.address);
        if (poolIdx !== undefined) {
          const stakedBalance = await getStakedBalance(
            accessToken,
            config.rewardsChef,
            poolIdx,
            userAddress
          );
          stakedBalanceMap!.set(pool.lpToken.address, stakedBalance);
        }
      })
    );
  }

  return buildPoolList(validatedPools, priceMap, volumeMap, validatedFactory, userAddress, stakedBalanceMap);
};

// --- Token Queries ---

export const getSwapableTokens = async (
  accessToken: string,
  userAddress: string
): Promise<SwapToken[]> => {
  const { data: poolData } = await cirrus.get(accessToken, `/${Pool}`, {
    params: {
      poolFactory: "eq." + constants.poolFactory,
      select: `address,tokenA:tokenA_fkey(${swapTokenSelectFields.join(',')}),tokenB:tokenB_fkey(${swapTokenSelectFields.join(',')}),tokenABalance::text,tokenBBalance::text`,
      "tokenA.balances.key": `eq.${userAddress}`,
      "tokenB.balances.key": `eq.${userAddress}`,
    }
  });

  // Filter out hidden pools
  const validatedPools = (poolData as (PoolWithTokens & { address: string })[]).filter(
    pool => !config.hiddenSwapPools.has(pool.address)
  ) as PoolWithTokens[];
  const tokenAddresses = extractTokenAddresses(validatedPools);
  const priceMap = await getOraclePrices(accessToken, {
    select: "asset:key,price:value::text",
    key: `in.(${tokenAddresses.join(',')})`
  });

  const tokenMap = new Map<string, SwapToken>();

  validatedPools.forEach((pool: PoolWithTokens) => {
    [pool.tokenA, pool.tokenB].forEach((token: RawToken, index: number) => {

      if (!tokenMap.has(token.address)) {
        const price = priceMap.get(token.address) || "0";
        const poolBalance = index === 0 ? pool.tokenABalance : pool.tokenBBalance;

        tokenMap.set(token.address, buildSwapToken(token, price, poolBalance, getTokenBalance(token, userAddress)));
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
  const [{ data: poolDataA }, { data: poolDataB }] = await Promise.all([
    cirrus.get(accessToken, `/${Pool}`, {
      params: {
        poolFactory: "eq." + constants.poolFactory,
        select: `address,tokenB:tokenB_fkey(${swapTokenSelectFields.join(',')}),tokenBBalance::text`,
        tokenA: "eq." + tokenAddress,
        "tokenB.balances.key": `eq.${userAddress}`,
      }
    }),
    cirrus.get(accessToken, `/${Pool}`, {
      params: {
        poolFactory: "eq." + constants.poolFactory,
        select: `address,tokenA:tokenA_fkey(${swapTokenSelectFields.join(',')}),tokenABalance::text`,
        tokenB: "eq." + tokenAddress,
        "tokenA.balances.key": `eq.${userAddress}`,
      }
    })
  ]);

  // Filter out hidden pools
  const validatedPoolsA = (poolDataA as (PoolWithTokenB & { address: string })[]).filter(
    pool => !config.hiddenSwapPools.has(pool.address)
  ) as PoolWithTokenB[];
  const validatedPoolsB = (poolDataB as (PoolWithTokenA & { address: string })[]).filter(
    pool => !config.hiddenSwapPools.has(pool.address)
  ) as PoolWithTokenA[];

  const allTokens: Array<{token: RawToken, poolBalance: string}> = [
    ...validatedPoolsA.map(pool => ({ token: pool.tokenB, poolBalance: pool.tokenBBalance })),
    ...validatedPoolsB.map(pool => ({ token: pool.tokenA, poolBalance: pool.tokenABalance })),
  ];

  const tokenAddresses = extractTokenAddressesFromTokens(allTokens.map(item => item.token));
  const priceMap = await getOraclePrices(accessToken, {
    select: "asset:key,price:value::text",
    key: `in.(${tokenAddresses.join(',')})`
  });

  const tokenMap = new Map<string, SwapToken>();

  allTokens.forEach(({token, poolBalance}) => {
    if (!tokenMap.has(token.address)) {
      const price = priceMap.get(token.address) || "0";
      tokenMap.set(token.address, buildSwapToken(token, price, poolBalance, getTokenBalance(token, userAddress)));
    }
  });

  return Array.from(tokenMap.values());
};

// --- Analytics Queries ---

export const getSwapHistory = async (
  accessToken: string,
  poolAddress: string,
  page: number = 1,
  limit: number = 10,
  senderAddress?: string
): Promise<SwapHistoryResponse> => {
  const offset = (page - 1) * limit;

  const [swapEventsResponse, countResponse] = await Promise.all([
    cirrus.get(accessToken, `/${PoolSwap}`, {
      params: {
        address: `eq.${poolAddress}`,
        ...(senderAddress ? { sender: `eq.${senderAddress}` } : {}),
        select: swapHistorySelectFields.join(','),
        order: 'block_timestamp.desc',
        limit: limit.toString(),
        offset: offset.toString(),
      }
    }),
    cirrus.get(accessToken, `/${PoolSwap}`, {
      params: {
        address: `eq.${poolAddress}`,
        ...(senderAddress ? { sender: `eq.${senderAddress}` } : {}),
        select: "count()",
      }
    })
  ]);

  const { data: swapEvents } = swapEventsResponse;
  const totalCount = countResponse.data?.[0]?.count || 0;

  if (!Array.isArray(swapEvents)) {
    return { data: [], totalCount: 0 };
  }

  const swapHistory: SwapHistoryEntry[] = (swapEvents as RawSwapEvent[]).map(event => {
    const { tokenA, tokenB, isStable } = event.pool;
    const isAToB = event.tokenIn === tokenA.address;

    return {
      id: event.id,
      timestamp: new Date(event.block_timestamp),
      tokenIn: isAToB ? tokenA.symbol : tokenB.symbol,
      tokenOut: isAToB ? tokenB.symbol : tokenA.symbol,
      amountIn: event.amountIn,
      amountOut: event.amountOut,
      impliedPrice: calculateImpliedPrice(event.amountIn, event.amountOut, isAToB, isStable),
      sender: event.sender
    };
  });

  return { data: swapHistory, totalCount };
};

// ============================================================================
// WRITE OPERATIONS
// ============================================================================

export const createPool = async (
  accessToken: string,
  body: CreatePoolParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { isStable, ...restBody } = body;
  const tx = await buildFunctionTx({
    contractName: extractContractName(PoolFactory),
    contractAddress: constants.poolFactory,
    method: isStable ? "createStablePool" : "createPool",
    args: restBody,
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

// --- Liquidity Operations ---

export const addLiquidityDualToken = async (
  accessToken: string,
  params: LiquidityParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, tokenBAmount, maxTokenAAmount, deadline, stakeLPToken } = params;

  const pool = await fetchPoolTokenAddresses(accessToken, poolAddress);

  // Prepare for LP token staking if requested
  let lpTokenAddress: string | undefined;
  let lpTokenBalanceBefore: string = "0";
  let rewardsPool: Awaited<ReturnType<typeof findPoolByLpToken>>;

  if (stakeLPToken) {
    lpTokenAddress = await fetchLPTokenAddress(accessToken, poolAddress);
    rewardsPool = await findPoolByLpToken(accessToken, config.rewardsChef, lpTokenAddress);

    if (rewardsPool) {
      lpTokenBalanceBefore = await getTokenBalanceForUser(accessToken, lpTokenAddress, userAddress);
    }
  }

  // Execute liquidity deposit
  const tx = await buildFunctionTx([
    buildTokenApprovalTx(pool.tokenA, poolAddress, maxTokenAAmount),
    buildTokenApprovalTx(pool.tokenB, poolAddress, tokenBAmount),
    {
      contractName: extractContractName(Pool),
      contractAddress: poolAddress,
      method: "addLiquidity",
      args: { tokenBAmount, maxTokenAAmount, deadline }
    }
  ], userAddress, accessToken);

  const depositResult = await executeTransaction(accessToken, tx);

  // Stake newly minted LP tokens if requested and deposit succeeded
  if (stakeLPToken && depositResult.status === "Success" && lpTokenAddress && rewardsPool) {
    await stakeNewLPTokens(accessToken, userAddress, lpTokenAddress, rewardsPool.poolIdx, lpTokenBalanceBefore);
  }

  return depositResult;
};

export const addLiquiditySingleToken = async (
  accessToken: string,
  params: SingleTokenLiquidityParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, singleTokenAmount, isAToB, deadline, stakeLPToken } = params;

  const pool = await fetchPoolTokenAddresses(accessToken, poolAddress);
  const depositTokenAddress = isAToB ? pool.tokenA : pool.tokenB;

  // Prepare for LP token staking if requested
  let lpTokenAddress: string | undefined;
  let lpTokenBalanceBefore: string = "0";
  let rewardsPool: Awaited<ReturnType<typeof findPoolByLpToken>>;

  if (stakeLPToken) {
    lpTokenAddress = await fetchLPTokenAddress(accessToken, poolAddress);
    rewardsPool = await findPoolByLpToken(accessToken, config.rewardsChef, lpTokenAddress);

    if (rewardsPool) {
      lpTokenBalanceBefore = await getTokenBalanceForUser(accessToken, lpTokenAddress, userAddress);
    }
  }

  // Execute liquidity deposit
  const tx = await buildFunctionTx([
    buildTokenApprovalTx(depositTokenAddress, poolAddress, singleTokenAmount),
    {
      contractName: extractContractName(Pool),
      contractAddress: poolAddress,
      method: "addLiquiditySingleToken",
      args: { isAToB, amountIn: singleTokenAmount, deadline }
    }
  ], userAddress, accessToken);

  const depositResult = await executeTransaction(accessToken, tx);

  // Stake newly minted LP tokens if requested and deposit succeeded
  if (stakeLPToken && depositResult.status === "Success" && lpTokenAddress && rewardsPool) {
    await stakeNewLPTokens(accessToken, userAddress, lpTokenAddress, rewardsPool.poolIdx, lpTokenBalanceBefore);
  }

  return depositResult;
};

export const removeLiquidity = async (
  accessToken: string,
  removeLiquidityParams: RemoveLiquidityParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, lpTokenAmount, deadline, includeStakedLPToken } = removeLiquidityParams;

  const pool = await fetchPoolBalances(accessToken, poolAddress);

  // Calculate tokenA and tokenB amounts
  const tokenABalance = BigInt(pool.tokenABalance);
  const tokenBBalance = BigInt(pool.tokenBBalance);
  const lpTokenSupply = BigInt(pool.lpToken._totalSupply);
  const lpTokenAmountBigInt = BigInt(lpTokenAmount);

  const tokenAAmount = (tokenABalance * lpTokenAmountBigInt) / lpTokenSupply;
  const tokenBAmount = (tokenBBalance * lpTokenAmountBigInt) / lpTokenSupply;

  // Apply 1% slippage tolerance (99 basis points)
  const minTokenAAmount = (tokenAAmount * 99n) / 100n;
  const minTokenBAmount = (tokenBAmount * 99n) / 100n;

  const txArray: any[] = [];

  // If includeStakedLPToken is true, check if we need to unstake from RewardsChef first
  if (includeStakedLPToken) {
    const lpTokenAddress = await fetchLPTokenAddress(accessToken, poolAddress);
    const rewardsPool = await findPoolByLpToken(accessToken, config.rewardsChef, lpTokenAddress);

    if (rewardsPool) {
      // Get user's wallet LP token balance
      const walletLPBalance = BigInt(await getTokenBalanceForUser(accessToken, lpTokenAddress, userAddress));

      // Get staked LP token balance
      const stakedBalance = await getStakedBalance(accessToken, config.rewardsChef, rewardsPool.poolIdx, userAddress);
      const stakedLPBalance = BigInt(stakedBalance);

      // Calculate required LP tokens and how much needs to be unstaked
      const requiredLPTokens = lpTokenAmountBigInt;

      if (requiredLPTokens > walletLPBalance) {
        // Need to unstake some LP tokens first
        const amountToUnstake = requiredLPTokens - walletLPBalance;

        if (amountToUnstake > stakedLPBalance) {
          throw new Error(`Insufficient LP tokens: need ${requiredLPTokens.toString()}, have ${walletLPBalance.toString()} in wallet and ${stakedLPBalance.toString()} staked`);
        }

        // Add unstake transaction
        txArray.push({
          contractName: "RewardsChef",
          contractAddress: config.rewardsChef,
          method: "withdraw",
          args: {
            _pid: rewardsPool.poolIdx,
            _amount: amountToUnstake.toString()
          }
        });
      }
    }
  }

  // Add removeLiquidity transaction
  txArray.push({
    contractName: extractContractName(Pool),
    contractAddress: poolAddress,
    method: "removeLiquidity",
    args: {
      lpTokenAmount,
      minTokenBAmount: minTokenBAmount.toString(),
      minTokenAAmount: minTokenAAmount.toString(),
      deadline
    },
  });

  const tx = await buildFunctionTx(txArray, userAddress, accessToken);
  return executeTransaction(accessToken, tx);
};

// --- Swap Operations ---

export const swap = async (
  accessToken: string,
  swapParams: SwapParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, isAToB, amountIn, minAmountOut, deadline } = swapParams;

  const pool = await fetchPoolTokenAddresses(accessToken, poolAddress);

  const tokenAddress = isAToB ? pool.tokenA : pool.tokenB;

  const tx = await buildFunctionTx([
    buildTokenApprovalTx(tokenAddress, poolAddress, amountIn),
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
  ], userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

// --- Admin Operations ---

export const setPoolRates = async (
  accessToken: string,
  setPoolRatesParams: SetPoolRatesParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, swapFeeRate, lpSharePercent } = setPoolRatesParams;

  // Call setPoolFeeParameters on PoolFactory instead of calling Pool directly
  const tx = await buildFunctionTx({
    contractName: extractContractName(PoolFactory),
    contractAddress: config.poolFactory,
    method: "setPoolFeeParameters",
    args: {
      poolAddress: poolAddress,
      newSwapFeeRate: swapFeeRate.toString(),
      newLpSharePercent: lpSharePercent.toString(),
    },
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

