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
  stakeNewLPTokens,
  fetchPoolCoins,
  fetchPoolTokenBalances,
  fetchTokenMetadata,
  buildPoolCoins,
  calculateMultiTokenLPPrice,
  calculateMultiTokenLiquidity,
  resolveCoinIndex,
  calculateLPFees24h,
  calculatePoolAPY,
  fetchMultiTokenStablePools,
  buildMultiTokenPoolEntry,
} from "../helpers/swapping.helper";
import { getOraclePrices } from "./oracle.service";
import { getPools as getRewardsChefPools } from "./rewardsChef.service";
import { getStakedBalance, findPoolByLpToken } from "../helpers/rewards/rewardsChef.helpers";
import { getTokenBalanceForUser } from "./tokens.service";
import {
  SwapHistoryEntry,
  PoolList,
  Pool,
  SwapParams,
  LiquidityParams,
  RemoveLiquidityParams,
  SingleTokenLiquidityParams,
  MultiTokenSwapParams,
  MultiTokenLiquidityParams,
  MultiTokenRemoveLiquidityParams,
  MultiTokenRemoveLiquidityOneParams,
  PoolCoin,
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

const { Pool: PoolTable, PoolFactory, PoolSwap, StablePool: StablePoolTable, swapHistorySelectFields, swapTokenSelectFields } = constants;

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
    cirrus.get(accessToken, `/${PoolTable}`, { params }),
    cirrus.get(accessToken, `/${PoolFactory}`, {
      params: { address: "eq." + config.poolFactory, select: "swapFeeRate,lpSharePercent" }
    })
  ]);

  // Filter out hidden pools and pools with deactivated tokens (status !== 2 = ACTIVE)
  const ACTIVE_TOKEN_STATUS = "2";
  const validatedPools = (poolData as RawGetPool[]).filter(
    pool => !config.hiddenSwapPools.has(pool.address)
      && pool.tokenA.status === ACTIVE_TOKEN_STATUS
      && pool.tokenB.status === ACTIVE_TOKEN_STATUS
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
  let lpTokenToPoolIdx: Map<string, number> | undefined;
  if (userAddress) {
    const rewardsChefPools = await getRewardsChefPools(accessToken, config.rewardsChef);

    lpTokenToPoolIdx = new Map<string, number>();
    rewardsChefPools.forEach(pool => {
      lpTokenToPoolIdx!.set(pool.lpToken, pool.poolIdx);
    });

    stakedBalanceMap = new Map<string, string>();
    await Promise.all(
      validatedPools.map(async (pool) => {
        const poolIdx = lpTokenToPoolIdx!.get(pool.lpToken.address);
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

  const poolList: any[] = buildPoolList(validatedPools, priceMap, volumeMap, validatedFactory, userAddress, stakedBalanceMap);

  // Replace or add multi-token stable pools. These pools also appear in the BlockApps-Pool table
  // (from Pool(pool).setFeeParameters()) but with invalid tokenA/tokenB. Replace those entries
  // with properly built multi-token pool entries.
  const multiTokenStablePools = await fetchMultiTokenStablePools(accessToken);
  await Promise.all(multiTokenStablePools.map(async (stablePool) => {
    try {
      // Fetch staked balance for multi-token pool LP token if not already cached
      let lpStakedBalance = stakedBalanceMap?.get(stablePool.lpToken);
      if (lpStakedBalance === undefined && userAddress && lpTokenToPoolIdx) {
        const poolIdx = lpTokenToPoolIdx.get(stablePool.lpToken);
        if (poolIdx !== undefined) {
          lpStakedBalance = await getStakedBalance(accessToken, config.rewardsChef, poolIdx, userAddress);
          stakedBalanceMap?.set(stablePool.lpToken, lpStakedBalance);
        }
      }
      const poolEntry = await buildMultiTokenPoolEntry(
        accessToken, stablePool, priceMap, volumeMap, validatedFactory, userAddress, lpStakedBalance
      );
      const existingIdx = poolList.findIndex((p: any) => p.address === stablePool.address);
      if (existingIdx !== -1) {
        poolList[existingIdx] = poolEntry;
      } else {
        poolList.push(poolEntry);
      }
    } catch (err) {
      console.error(`Failed to build multi-token pool ${stablePool.address}:`, err);
    }
  }));

  return poolList;
};

// --- Token Queries ---

export const getSwapableTokens = async (
  accessToken: string,
  userAddress: string
): Promise<SwapToken[]> => {
  const { data: poolData } = await cirrus.get(accessToken, `/${PoolTable}`, {
    params: {
      poolFactory: "eq." + constants.poolFactory,
      isDisabled: "eq.false",
      select: `address,tokenA:tokenA_fkey(${swapTokenSelectFields.join(',')}),tokenB:tokenB_fkey(${swapTokenSelectFields.join(',')}),tokenABalance::text,tokenBBalance::text`,
      "tokenA.balances.key": `eq.${userAddress}`,
      "tokenB.balances.key": `eq.${userAddress}`,
    }
  });

  // Filter out hidden pools and pools with deactivated tokens
  const ACTIVE_TOKEN_STATUS = "2";
  const validatedPools = (poolData as (PoolWithTokens & { address: string })[]).filter(
    pool => !config.hiddenSwapPools.has(pool.address)
      && pool.tokenA.status === ACTIVE_TOKEN_STATUS
      && pool.tokenB.status === ACTIVE_TOKEN_STATUS
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

  // Also include tokens from dynamically discovered multi-token pools
  const multiTokenStablePools = await fetchMultiTokenStablePools(accessToken);
  await Promise.all(multiTokenStablePools.map(async (stablePool) => {
    try {
      // Only include coins that have balance > 0 in the pool
      const fundedCoins = stablePool.coins.filter(c => {
        const balance = stablePool.tokenBalances.get(c.tokenAddress) || "0";
        return BigInt(balance) > 0n;
      });

      // Update existing tokens that have 0 poolBalance with the multi-token pool balance
      fundedCoins.forEach(c => {
        const existing = tokenMap.get(c.tokenAddress);
        if (existing && BigInt(existing.poolBalance || "0") === 0n) {
          const poolBalance = stablePool.tokenBalances.get(c.tokenAddress) || "0";
          tokenMap.set(c.tokenAddress, { ...existing, poolBalance });
        }
      });

      const coinAddresses = fundedCoins.map(c => c.tokenAddress).filter(addr => !tokenMap.has(addr));
      if (coinAddresses.length === 0) return;

      const tokenMetadataMap = await fetchTokenMetadata(accessToken, coinAddresses, userAddress);

      // Fetch prices for new tokens
      const additionalPrices = await getOraclePrices(accessToken, {
        select: "asset:key,price:value::text",
        key: `in.(${coinAddresses.join(',')})`
      });

      coinAddresses.forEach(addr => {
        const token = tokenMetadataMap.get(addr);
        if (token) {
          const price = additionalPrices.get(addr) || "0";
          const poolBalance = stablePool.tokenBalances.get(addr) || "0";
          tokenMap.set(addr, buildSwapToken(token, price, poolBalance, getTokenBalance(token, userAddress)));
        }
      });
    } catch (err) {
      console.error(`Failed to fetch multi-token pool coins for ${stablePool.address}:`, err);
    }
  }));

  return Array.from(tokenMap.values());
};

export const getSwapableTokenPairs = async (
  accessToken: string,
  tokenAddress: string,
  userAddress: string
): Promise<SwapToken[]> => {
  const [{ data: poolDataA }, { data: poolDataB }] = await Promise.all([
    cirrus.get(accessToken, `/${PoolTable}`, {
      params: {
        poolFactory: "eq." + constants.poolFactory,
        isDisabled: "eq.false",
        select: `address,tokenB:tokenB_fkey(${swapTokenSelectFields.join(',')}),tokenBBalance::text`,
        tokenA: "eq." + tokenAddress,
        "tokenB.balances.key": `eq.${userAddress}`,
      }
    }),
    cirrus.get(accessToken, `/${PoolTable}`, {
      params: {
        poolFactory: "eq." + constants.poolFactory,
        isDisabled: "eq.false",
        select: `address,tokenA:tokenA_fkey(${swapTokenSelectFields.join(',')}),tokenABalance::text`,
        tokenB: "eq." + tokenAddress,
        "tokenA.balances.key": `eq.${userAddress}`,
      }
    })
  ]);

  // Filter out hidden pools and pools with deactivated tokens
  const ACTIVE_TOKEN_STATUS = "2";
  const validatedPoolsA = (poolDataA as (PoolWithTokenB & { address: string })[]).filter(
    pool => !config.hiddenSwapPools.has(pool.address)
      && pool.tokenB.status === ACTIVE_TOKEN_STATUS
  ) as PoolWithTokenB[];
  const validatedPoolsB = (poolDataB as (PoolWithTokenA & { address: string })[]).filter(
    pool => !config.hiddenSwapPools.has(pool.address)
      && pool.tokenA.status === ACTIVE_TOKEN_STATUS
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

  // For multi-token pools: if the selected token is in a multi-token pool,
  // add all other coins from that pool as pairable tokens (only if both have balance > 0)
  const multiTokenStablePools = await fetchMultiTokenStablePools(accessToken);
  for (const stablePool of multiTokenStablePools) {
    try {
      // Check if the selected token is in this pool and has balance > 0
      const selectedCoin = stablePool.coins.find(
        c => c.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
      );
      if (!selectedCoin) continue;
      const selectedBalance = stablePool.tokenBalances.get(selectedCoin.tokenAddress) || "0";
      if (BigInt(selectedBalance) === 0n) continue;

      // Add other coins that have balance > 0 as pairable tokens
      const otherFundedCoins = stablePool.coins.filter(c => {
        if (c.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()) return false;
        const balance = stablePool.tokenBalances.get(c.tokenAddress) || "0";
        return BigInt(balance) > 0n;
      });

      // Update existing tokens that have 0 poolBalance with the multi-token pool balance
      otherFundedCoins.forEach(c => {
        const existing = tokenMap.get(c.tokenAddress);
        if (existing && BigInt(existing.poolBalance || "0") === 0n) {
          const poolBalance = stablePool.tokenBalances.get(c.tokenAddress) || "0";
          tokenMap.set(c.tokenAddress, { ...existing, poolBalance });
        }
      });

      const otherCoinAddresses = otherFundedCoins
        .map(c => c.tokenAddress)
        .filter(addr => !tokenMap.has(addr));
      if (otherCoinAddresses.length === 0) continue;

      const tokenMetadataMap = await fetchTokenMetadata(accessToken, otherCoinAddresses, userAddress);

      const additionalPrices = await getOraclePrices(accessToken, {
        select: "asset:key,price:value::text",
        key: `in.(${otherCoinAddresses.join(',')})`
      });

      otherCoinAddresses.forEach(addr => {
        const token = tokenMetadataMap.get(addr);
        if (token) {
          const price = additionalPrices.get(addr) || "0";
          const poolBalance = stablePool.tokenBalances.get(addr) || "0";
          tokenMap.set(addr, buildSwapToken(token, price, poolBalance, getTokenBalance(token, userAddress)));
        }
      });
    } catch (err) {
      console.error(`Failed to fetch multi-token pool pairs for ${stablePool.address}:`, err);
    }
  }

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
      contractName: extractContractName(PoolTable),
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
      contractName: extractContractName(PoolTable),
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
    contractName: extractContractName(PoolTable),
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
      contractName: extractContractName(PoolTable),
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

// --- Multi-Token Operations ---

export const exchangeMultiToken = async (
  accessToken: string,
  params: MultiTokenSwapParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, tokenIn, tokenOut, amountIn, minAmountOut, deadline } = params;

  // Resolve coin indices
  const coinEntries = await fetchPoolCoins(accessToken, poolAddress);
  const i = resolveCoinIndex(coinEntries, tokenIn);
  const j = resolveCoinIndex(coinEntries, tokenOut);

  const tx = await buildFunctionTx([
    buildTokenApprovalTx(tokenIn, poolAddress, amountIn),
    {
      contractName: extractContractName(StablePoolTable),
      contractAddress: poolAddress,
      method: "exchange",
      args: {
        i,
        j,
        _dx: amountIn,
        _minDy: minAmountOut,
        _receiver: userAddress,
      },
    }
  ], userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

export const addLiquidityMultiToken = async (
  accessToken: string,
  params: MultiTokenLiquidityParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, amounts, minMintAmount, deadline, stakeLPToken } = params;

  const coinEntries = await fetchPoolCoins(accessToken, poolAddress);

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

  // Build approval transactions for each coin being deposited
  const approvalTxs = coinEntries
    .filter((_, idx) => amounts[idx] && amounts[idx] !== "0" && BigInt(amounts[idx]) > 0n)
    .map(coin => buildTokenApprovalTx(coin.tokenAddress, poolAddress, amounts[coin.coinIndex]));

  const tx = await buildFunctionTx([
    ...approvalTxs,
    {
      contractName: extractContractName(StablePoolTable),
      contractAddress: poolAddress,
      method: "addLiquidityGeneral",
      args: {
        _amounts: amounts,
        _minMintAmount: minMintAmount,
        _receiver: userAddress,
      },
    }
  ], userAddress, accessToken);

  const depositResult = await executeTransaction(accessToken, tx);

  // Stake newly minted LP tokens if requested
  if (stakeLPToken && depositResult.status === "Success" && lpTokenAddress && rewardsPool) {
    await stakeNewLPTokens(accessToken, userAddress, lpTokenAddress, rewardsPool.poolIdx, lpTokenBalanceBefore);
  }

  return depositResult;
};

export const removeLiquidityMultiToken = async (
  accessToken: string,
  params: MultiTokenRemoveLiquidityParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, lpTokenAmount, minAmounts, deadline, includeStakedLPToken } = params;

  const txArray: any[] = [];

  // Unstake from RewardsChef if needed
  if (includeStakedLPToken) {
    const lpTokenAddress = await fetchLPTokenAddress(accessToken, poolAddress);
    const rewardsPool = await findPoolByLpToken(accessToken, config.rewardsChef, lpTokenAddress);

    if (rewardsPool) {
      const walletLPBalance = BigInt(await getTokenBalanceForUser(accessToken, lpTokenAddress, userAddress));
      const stakedBalance = await getStakedBalance(accessToken, config.rewardsChef, rewardsPool.poolIdx, userAddress);
      const stakedLPBalance = BigInt(stakedBalance);
      const requiredLPTokens = BigInt(lpTokenAmount);

      if (requiredLPTokens > walletLPBalance) {
        const amountToUnstake = requiredLPTokens - walletLPBalance;
        if (amountToUnstake > stakedLPBalance) {
          throw new Error(`Insufficient LP tokens: need ${requiredLPTokens.toString()}, have ${walletLPBalance.toString()} in wallet and ${stakedLPBalance.toString()} staked`);
        }
        txArray.push({
          contractName: "RewardsChef",
          contractAddress: config.rewardsChef,
          method: "withdraw",
          args: { _pid: rewardsPool.poolIdx, _amount: amountToUnstake.toString() }
        });
      }
    }
  }

  txArray.push({
    contractName: extractContractName(StablePoolTable),
    contractAddress: poolAddress,
    method: "removeLiquidityGeneral",
    args: {
      _burnAmount: lpTokenAmount,
      _minAmounts: minAmounts,
      _receiver: userAddress,
      _claimAdminFees: true,
    },
  });

  const tx = await buildFunctionTx(txArray, userAddress, accessToken);
  return executeTransaction(accessToken, tx);
};

export const removeLiquidityMultiTokenOneCoin = async (
  accessToken: string,
  params: MultiTokenRemoveLiquidityOneParams,
  userAddress: string
): Promise<TransactionResponse> => {
  const { poolAddress, lpTokenAmount, coinIndex, minReceived, deadline, includeStakedLPToken } = params;

  const txArray: any[] = [];

  // Unstake from RewardsChef if needed
  if (includeStakedLPToken) {
    const lpTokenAddress = await fetchLPTokenAddress(accessToken, poolAddress);
    const rewardsPool = await findPoolByLpToken(accessToken, config.rewardsChef, lpTokenAddress);

    if (rewardsPool) {
      const walletLPBalance = BigInt(await getTokenBalanceForUser(accessToken, lpTokenAddress, userAddress));
      const stakedBalance = await getStakedBalance(accessToken, config.rewardsChef, rewardsPool.poolIdx, userAddress);
      const stakedLPBalance = BigInt(stakedBalance);
      const requiredLPTokens = BigInt(lpTokenAmount);

      if (requiredLPTokens > walletLPBalance) {
        const amountToUnstake = requiredLPTokens - walletLPBalance;
        if (amountToUnstake > stakedLPBalance) {
          throw new Error(`Insufficient LP tokens`);
        }
        txArray.push({
          contractName: "RewardsChef",
          contractAddress: config.rewardsChef,
          method: "withdraw",
          args: { _pid: rewardsPool.poolIdx, _amount: amountToUnstake.toString() }
        });
      }
    }
  }

  txArray.push({
    contractName: extractContractName(StablePoolTable),
    contractAddress: poolAddress,
    method: "removeliquidityOneCoin",
    args: {
      _burnAmount: lpTokenAmount,
      i: coinIndex,
      _minReceived: minReceived,
      _receiver: userAddress,
    },
  });

  const tx = await buildFunctionTx(txArray, userAddress, accessToken);
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

export const pausePool = async (
  accessToken: string,
  poolAddress: string,
  userAddress: string
): Promise<TransactionResponse> => {
  const tx = await buildFunctionTx({
    contractName: extractContractName(PoolTable),
    contractAddress: poolAddress,
    method: "setPaused",
    args: {
      _isPaused: true,
    },
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

export const unpausePool = async (
  accessToken: string,
  poolAddress: string,
  userAddress: string
): Promise<TransactionResponse> => {
  const tx = await buildFunctionTx({
    contractName: extractContractName(PoolTable),
    contractAddress: poolAddress,
    method: "setPaused",
    args: {
      _isPaused: false,
    },
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

export const disablePool = async (
  accessToken: string,
  poolAddress: string,
  userAddress: string
): Promise<TransactionResponse> => {
  const tx = await buildFunctionTx({
    contractName: extractContractName(PoolTable),
    contractAddress: poolAddress,
    method: "setDisabled",
    args: {
      _isDisabled: true,
    },
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

export const enablePool = async (
  accessToken: string,
  poolAddress: string,
  userAddress: string
): Promise<TransactionResponse> => {
  const tx = await buildFunctionTx({
    contractName: extractContractName(PoolTable),
    contractAddress: poolAddress,
    method: "setDisabled",
    args: {
      _isDisabled: false,
    },
  }, userAddress, accessToken);

  return executeTransaction(accessToken, tx);
};

