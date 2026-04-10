import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { hiddenSwapPools, yieldBenchmarks, compositeYieldMap } from "../../config/config";
import * as appConfig from "../../config/config";
import { toUTCTime } from "../helpers/cirrusHelpers";
import { buildYieldAnchorOverlapFilter, computeExchangeRateAPY, getYieldWindowBounds, indexYieldHistoryRows, mergeBackfillRows } from "../helpers/earnYield.helper";
import { totalDebtFromScaled, calculateAPYs } from "../helpers/lending.helper";
import { calculateLPTokenPrice, fetchMultiTokenStablePools } from "../helpers/swapping.helper";
import stakeSemanticsConfig from "./rewardsStakeSemantics.json";
import {
  computeEquityFromMaps,
  computeVaultPerformanceMetrics,
  safeBigInt,
} from "../helpers/vaultPerformance.helper";
import { getSaveUsdstInfo } from "./saveUsdst.service";
import { ApySource, TokenApyEntry } from "@mercata/shared-types";

const { Pool, DECIMALS, Vault, Token } = constants;
const ZERO_APY = "0.00";
const CATA_PRICE_USD = 0.25;
const STAKE_SEMANTICS = stakeSemanticsConfig as any;
const USD_NOTIONAL_SWAP_SOURCES = new Set<string>(
  STAKE_SEMANTICS.usd_notional.swapSources.map((source: string) => normalizeAddress(source))
);
const USD_NOTIONAL_DEPOSIT_COMPLETED_SOURCES = new Set<string>(
  STAKE_SEMANTICS.usd_notional.depositCompletedSources.map((source: string) => normalizeAddress(source))
);
const USD_NOTIONAL_AMOUNT_USD_SOURCES = new Set<string>(
  STAKE_SEMANTICS.usd_notional.amountUsdSources.map((source: string) => normalizeAddress(source))
);
const TOKEN_UNITS_SOURCES = new Set<string>(
  STAKE_SEMANTICS.token_units.lpMintBurnSources.map((source: string) => normalizeAddress(source))
);

export const getTokenApys = async (accessToken: string): Promise<TokenApyEntry[]> => {
  const now = Date.now();
  const twentyFourHoursAgo = toUTCTime(new Date(now - 24 * 60 * 60 * 1000));
  const thirtyDaysAgo = toUTCTime(new Date(now - 30 * 24 * 60 * 60 * 1000));
  const { windowStart, windowEndExclusive, anchorsMs } = getYieldWindowBounds(now);
  const vaultAddr = constants.vault;
  const rewardsAddr = appConfig.rewards;

  const mappingOr = `(and(address.eq.${constants.lendingPool},collection_name.eq.assetConfigs,key->>key.eq.${constants.USDST}),and(address.eq.${constants.USDST},collection_name.eq._balances,key->>key.eq.${constants.liquidityPool}),and(address.eq.${constants.priceOracle},collection_name.eq.prices)${vaultAddr ? `,and(address.eq.${vaultAddr},collection_name.eq.supportedAssets)` : ""}${rewardsAddr ? `,and(address.eq.${rewardsAddr},collection_name.in.(activities,activityStates))` : ""})`;
  const eventOr = `(and(event_name.eq.Swap,block_timestamp.gte.${twentyFourHoursAgo}),and(address.eq.${constants.safetyModule},event_name.in.(Staked,Redeemed,RewardNotified,ShortfallCovered),block_timestamp.gte.${thirtyDaysAgo}))`;

  // Phase 1: parallel calls
  const exchangeRateAddrs = [...new Set([
    ...yieldBenchmarks.map((b) => b.tokenAddress),
    ...Object.values(compositeYieldMap),
  ])];

  const [
    { data: storageRows },
    { data: mappingRows },
    { data: eventRows },
    { data: pools },
    { data: vaultRows },
    saveUsdstInfo,
    { data: exchangeRateRows },
  ] = await Promise.all([
    cirrus.get(accessToken, "/storage", { params: {
      address: `in.(${constants.lendingPool},${constants.safetyModule},${constants.sToken}${vaultAddr ? `,${vaultAddr}` : ""})`,
      select: "address,data->>borrowableAsset,data->>mToken,data->>totalScaledDebt,data->>borrowIndex,data->>reservesAccrued,data->>_managedAssets,data->>_totalSupply,data->>botExecutor,data->>priceOracle",
    }}),
    cirrus.get(accessToken, "/mapping", { params: { select: "address,collection_name,key->>key,value::text", or: mappingOr } }),
    cirrus.get(accessToken, `/${constants.Event}`, { params: { select: "address,event_name,attributes,block_timestamp", or: eventOr } }),
    cirrus.get(accessToken, `/${Pool}`, { params: {
      poolFactory: `eq.${constants.poolFactory}`,
      select: "address,tokenA:tokenA_fkey(address,_symbol),tokenB:tokenB_fkey(address,_symbol),lpToken:lpToken_fkey(address,_symbol,_totalSupply::text),tokenABalance::text,tokenBBalance::text,swapFeeRate,lpSharePercent,isPaused,isDisabled",
    }}),
    vaultAddr
      ? cirrus.get(accessToken, `/${Vault}`, { params: {
        address: `eq.${vaultAddr}`,
        select: "shareToken",
      }})
      : Promise.resolve({ data: [] as any[] }),
    getSaveUsdstInfo(accessToken).catch(() => null),
    exchangeRateAddrs.length
      ? cirrus.get(accessToken, "/history@mapping", { params: {
        address: `eq.${constants.priceOracle}`,
        collection_name: "eq.exchangeRates",
        "key->>key": `in.(${exchangeRateAddrs.join(",")})`,
        select: "key->>key,value::text,valid_from,valid_to",
        and: `(block_timestamp.gte.${windowStart},block_timestamp.lt.${windowEndExclusive})`,
        or: buildYieldAnchorOverlapFilter(anchorsMs),
      }}).catch(() => ({ data: [] as any[] }))
      : Promise.resolve({ data: [] as any[] }),
  ]);

  // Parse storage
  const storageByAddr = new Map((storageRows || []).map((r: any) => [r.address, r]));
  const lpData: any = storageByAddr.get(constants.lendingPool);
  const smRow = storageByAddr.get(constants.safetyModule);
  const stRow = storageByAddr.get(constants.sToken);
  const vaultStorage: any = vaultAddr ? storageByAddr.get(vaultAddr) : null;
  const botExecutor = vaultStorage?.botExecutor;
  const shareTokenAddress = vaultRows?.[0]?.shareToken || "";

  // Parse mapping
  const prices = new Map<string, string>();
  let lendingCfg: any = null;
  let liqBalance: string | null = null;
  const vaultAssets: string[] = [];
  const rewardActivityCfgById = new Map<string, any>();
  const rewardActivityStateById = new Map<string, any>();
  for (const r of mappingRows || []) {
    if (r.collection_name === "prices") prices.set(r.key, r.value);
    else if (r.collection_name === "assetConfigs") lendingCfg = JSON.parse(r.value);
    else if (r.collection_name === "_balances") liqBalance = r.value;
    else if (r.collection_name === "supportedAssets" && r.value) {
      const addr = r.value.replace(/"/g, "");
      if (addr) vaultAssets.push(addr);
    } else if (rewardsAddr && normalizeAddress(r.address) === normalizeAddress(rewardsAddr) && r.value) {
      const parsed = parseMappingValue(r.value);
      if (!parsed) continue;
      const activityId = String(r.key || "");
      if (!activityId) continue;
      if (r.collection_name === "activities") rewardActivityCfgById.set(activityId, parsed);
      else if (r.collection_name === "activityStates") rewardActivityStateById.set(activityId, parsed);
    }
  }

  // Parse events (single pass)
  const swapEvents: any[] = [], smEvents: any[] = [];
  for (const e of eventRows || []) {
    switch (e.event_name) {
      case "Swap": swapEvents.push(e); break;
      case "Staked": case "Redeemed": case "RewardNotified": case "ShortfallCovered": smEvents.push(e); break;
    }
  }

  // Enrich prices with LP token prices from Phase 1 pool data (needed for reward stake USD)
  for (const p of pools || []) {
    if (p.lpToken?.address && p.lpToken._totalSupply) {
      const lpPrice = calculateLPTokenPrice(
        p.tokenABalance || "0", p.tokenBBalance || "0",
        prices.get(p.tokenA?.address) || "0", prices.get(p.tokenB?.address) || "0",
        p.lpToken._totalSupply
      );
      if (lpPrice !== "0") prices.set(p.lpToken.address, lpPrice);
    }
  }

  const rewardActivities = buildRewardActivitiesFromMappings(
    rewardActivityCfgById,
    rewardActivityStateById,
    {
    priceMap: prices,
    mTokenAddress: lpData?.mToken || null,
    sTokenAddress: constants.sToken || null,
    vaultShareTokenAddress: shareTokenAddress || null,
    saveUsdstVaultAddress: appConfig.saveUsdstVault || null,
  });
  const [{ data: poolFactoryRows }, stablePools] = await Promise.all([
    cirrus.get(accessToken, `/${constants.PoolFactory}`, {
      params: {
        address: `eq.${constants.poolFactory}`,
        select: "swapFeeRate,lpSharePercent",
      },
    }).catch(() => ({ data: [] as any[] })),
    fetchMultiTokenStablePools(accessToken).catch(() => []),
  ]);

  // Phase 2: vault APY needs current balances + historical NAV context
  let vaultAPY: string | null = null;
  let vaultRewardApy: string | null = null;
  const filteredVaultAssets = vaultAssets.filter(a => a !== "0000000000000000000000000000000000000000");
  const vaultOracle = vaultStorage?.priceOracle || constants.priceOracle;
  const currentVaultBalances = new Map<string, string>();
  if (vaultAddr && shareTokenAddress && botExecutor && filteredVaultAssets.length) {
    const balances = await getCurrentVaultBalances(accessToken, filteredVaultAssets, botExecutor);
    balances.forEach((value, key) => currentVaultBalances.set(key, value));

    const vaultEquity = computeEquityFromMaps(filteredVaultAssets, currentVaultBalances, prices);
    const vaultTotalShares = safeBigInt(await getTokenTotalSupply(accessToken, shareTokenAddress));

    const vaultMetrics = await computeVaultPerformanceMetrics(
      accessToken,
      vaultAddr,
      vaultEquity,
      vaultTotalShares,
      shareTokenAddress,
      botExecutor,
      vaultOracle,
      filteredVaultAssets,
      prices
    );

    vaultAPY = vaultMetrics.alpha !== "-" ? vaultMetrics.alpha : null;
    const vaultRewardsActivity = findRewardActivity(rewardActivities, {
      sourceContract: shareTokenAddress,
      stakeAssetAddress: shareTokenAddress,
      nameIncludes: ["vault"],
    });
    if (vaultRewardsActivity && !vaultRewardsActivity.totalStakeUsd && vaultTotalShares > 0n && vaultEquity > 0n) {
      const sharePrice = ((vaultEquity * DECIMALS) / vaultTotalShares).toString();
      vaultRewardsActivity.totalStakeUsd = toUsdValue(vaultRewardsActivity.totalStake || "0", sharePrice);
    }
    vaultRewardApy = computeRewardsApy(vaultRewardsActivity?.emissionRate, vaultRewardsActivity?.totalStakeUsd);
  }

  // Build result
  const map = new Map<string, ApySource[]>();
  const add = (t: string, e: ApySource) => { if (!map.has(t)) map.set(t, []); map.get(t)!.push(e); };

  if (lpData?.borrowableAsset && lendingCfg && liqBalance) {
    const lendingAPY = computeLendingAPY(lpData, lendingCfg, liqBalance);
    if (lendingAPY) {
      add(lpData.borrowableAsset, { source: "lending", apy: lendingAPY });
      if (lpData.mToken) add(lpData.mToken, { source: "lending", apy: lendingAPY });
    }
  }

  const lendingRewardsActivity = rewardActivities.find((activity) => {
    const name = String(activity?.name || "").toLowerCase();
    const source = normalizeAddress(activity?.sourceContract);
    const mTokenAddress = normalizeAddress(lpData?.mToken);
    return name.includes("lending pool liquidity") || (!!mTokenAddress && source === mTokenAddress);
  }) || null;
  const lendingRewardsApy = computeRewardsApy(lendingRewardsActivity?.emissionRate, lendingRewardsActivity?.totalStakeUsd);
  if (lendingRewardsApy && lpData?.borrowableAsset) {
    add(lpData.borrowableAsset, { source: "rewards", apy: lendingRewardsApy, meta: "lending" });
    if (lpData.mToken) add(lpData.mToken, { source: "rewards", apy: lendingRewardsApy, meta: "lending" });
  }

  const directMintRewardsActivity = findRewardActivity(rewardActivities, {
    sourceContract: constants.mercataBridge,
  });
  const directMintRewardsApy = computeRewardsApy(
    directMintRewardsActivity?.emissionRate,
    directMintRewardsActivity?.totalStakeUsd
  );
  if (directMintRewardsApy) {
    add(constants.USDST, { source: "rewards", apy: directMintRewardsApy, meta: "direct_mint" });
  }

  const saveUsdstAddress = normalizeAddress(saveUsdstInfo?.vaultAddress);
  const saveUsdstNativeApy =
    saveUsdstInfo?.apy && saveUsdstInfo.apy !== "-" && parseFloat(saveUsdstInfo.apy) > 0
      ? saveUsdstInfo.apy
      : null;
  const saveUsdstStakeUsd =
    saveUsdstInfo?.tvlUsd ||
    saveUsdstInfo?.pricingAssets ||
    saveUsdstInfo?.totalAssets ||
    null;
  const saveUsdstRewardsActivity = saveUsdstAddress
    ? findRewardActivity(rewardActivities, {
        sourceContract: saveUsdstAddress,
        stakeAssetAddress: saveUsdstAddress,
        nameIncludes: ["save usdst", "saveusdst"],
      })
    : null;
  const saveUsdstRewardsApy = computeRewardsApy(
    saveUsdstRewardsActivity?.emissionRate,
    saveUsdstRewardsActivity?.totalStakeUsd ?? saveUsdstStakeUsd
  );
  if (saveUsdstAddress) {
    // Reuse the native-yield source bucket so generic lookup surfaces still label it as Native APY.
    if (saveUsdstNativeApy) {
      add(saveUsdstAddress, { source: "lending", apy: saveUsdstNativeApy, meta: "save_usdst" });
    }
    if (saveUsdstRewardsApy) {
      add(saveUsdstAddress, { source: "rewards", apy: saveUsdstRewardsApy, meta: "save_usdst" });
    }
  }

  // Build per-asset exchange rate APY from exchangeRates history mapping.
  // Requires 2+ oracle data points on different calendar days before APY appears (see computeExchangeRateAPY).
  const exchangeRateHistory = indexYieldHistoryRows(mergeBackfillRows(exchangeRateRows || []));

  const baseYieldByAddr = new Map<string, number>();
  for (const { tokenAddress, tokenSymbol, baseSymbol } of yieldBenchmarks) {
    const apy = computeExchangeRateAPY(tokenAddress, exchangeRateHistory, anchorsMs);
    if (!apy) continue;
    const underlying = compositeYieldMap[tokenAddress];
    const underlyingApy = underlying ? computeExchangeRateAPY(underlying, exchangeRateHistory, anchorsMs) : null;
    const totalApy = parseFloat(apy) + (underlyingApy ? parseFloat(underlyingApy) : 0);
    add(tokenAddress, { source: "base", apy: totalApy.toFixed(2), meta: `${tokenSymbol}/${baseSymbol}` });
    baseYieldByAddr.set(tokenAddress, totalApy);
  }
  const vaultWeightedApy = currentVaultBalances.size > 0 && baseYieldByAddr.size > 0
    ? weightedBaseYield(
        filteredVaultAssets,
        filteredVaultAssets.map((addr) => currentVaultBalances.get(addr) || "0"),
        prices,
        baseYieldByAddr
      )
    : null;

  const volumeMap = buildVolumeMap(swapEvents, prices);
  const poolFactoryData = poolFactoryRows?.[0] || null;
  const factorySwapFeeRate = Number(poolFactoryData?.swapFeeRate || 30);
  const factoryLpSharePercent = Number(poolFactoryData?.lpSharePercent || 7000);
  const stablePoolAddresses = new Set(
    (stablePools || []).map((pool: any) => normalizeAddress(pool?.address)).filter(Boolean)
  );
  const activePools = (pools || []).filter((p: any) =>
    p.tokenA?.address && p.tokenB?.address && p.lpToken?.address &&
    !p.isPaused && !p.isDisabled &&
    !(p.tokenABalance === "0" && p.tokenBBalance === "0") &&
    !hiddenSwapPools.has(p.address) &&
    !stablePoolAddresses.has(normalizeAddress(p.address))
  );
  for (const p of activePools) {
    const meta = `${p.tokenA._symbol}-${p.tokenB._symbol}`;
    const poolAddress = String(p.address ?? "").toLowerCase().replace(/^0x/, "");
    const lpTokenAddress = p.lpToken.address;
    const swapApy = computePoolAPY(p, prices, volumeMap);
    const tokenABaseApy = baseYieldByAddr.get(p.tokenA.address);
    const tokenBBaseApy = baseYieldByAddr.get(p.tokenB.address);
    const poolRewardActivity = findPoolRewardActivity(rewardActivities, {
      poolAddress,
      lpTokenAddress,
    });
    const poolRewardApy = computeRewardsApy(poolRewardActivity?.emissionRate, poolRewardActivity?.totalStakeUsd);

    if (swapApy !== ZERO_APY) {
      const row = { source: "swap" as const, apy: swapApy, meta, ...(poolAddress ? { poolAddress } : {}) };
      add(lpTokenAddress, row);
      add(p.tokenA.address, row);
      add(p.tokenB.address, row);
    }
    if (baseYieldByAddr.size > 0) {
      const wApy = weightedBaseYield([p.tokenA.address, p.tokenB.address], [p.tokenABalance || "0", p.tokenBBalance || "0"], prices, baseYieldByAddr);
      if (wApy) {
        add(lpTokenAddress, { source: "weighted_swap", apy: wApy, meta, ...(poolAddress ? { poolAddress } : {}) });
      }
    }
    if (tokenABaseApy && tokenABaseApy > 0) {
      add(p.tokenA.address, { source: "base", apy: tokenABaseApy.toFixed(2), meta, ...(poolAddress ? { poolAddress } : {}) });
    }
    if (tokenBBaseApy && tokenBBaseApy > 0) {
      add(p.tokenB.address, { source: "base", apy: tokenBBaseApy.toFixed(2), meta, ...(poolAddress ? { poolAddress } : {}) });
    }
    if (poolRewardApy) {
      const rewardRow = { source: "rewards" as const, apy: poolRewardApy, meta, ...(poolAddress ? { poolAddress } : {}) };
      add(lpTokenAddress, rewardRow);
      add(p.tokenA.address, rewardRow);
      add(p.tokenB.address, rewardRow);
    }
  }

  for (const stablePool of stablePools || []) {
    const poolAddress = normalizeAddress(stablePool?.address);
    const lpTokenAddress = stablePool?.lpToken;
    const coinAddresses = (stablePool?.coins || []).map((coin: any) => coin?.tokenAddress).filter(Boolean);
    if (!poolAddress || !lpTokenAddress || coinAddresses.length === 0 || hiddenSwapPools.has(poolAddress)) continue;

    const meta = coinAddresses
      .map((address: string) => {
        const poolRow = (pools || []).find((pool: any) =>
          normalizeAddress(pool?.tokenA?.address) === normalizeAddress(address) ||
          normalizeAddress(pool?.tokenB?.address) === normalizeAddress(address)
        );
        if (normalizeAddress(poolRow?.tokenA?.address) === normalizeAddress(address)) return poolRow?.tokenA?._symbol;
        if (normalizeAddress(poolRow?.tokenB?.address) === normalizeAddress(address)) return poolRow?.tokenB?._symbol;
        return null;
      })
      .filter(Boolean)
      .join("-");

    let totalTvlUsd = 0;
    for (const address of coinAddresses) {
      const balanceRaw = stablePool?.tokenBalances?.get?.(address) || stablePool?.tokenBalances?.get?.(normalizeAddress(address)) || "0";
      const priceRaw = prices.get(address) || prices.get(normalizeAddress(address)) || "0";
      totalTvlUsd += Number((BigInt(balanceRaw) * BigInt(priceRaw)) / DECIMALS) / 1e18;
    }

    const volume24h = volumeMap.get(stablePool.address) || volumeMap.get(poolAddress) || 0;
    const swapApyValue = totalTvlUsd > 0
      ? (volume24h * (factorySwapFeeRate / 10000) * (factoryLpSharePercent / 10000) / totalTvlUsd) * 365 * 100
      : 0;
    const swapApy = swapApyValue > 0 ? swapApyValue.toFixed(2) : ZERO_APY;

    const poolRewardActivity = findPoolRewardActivity(rewardActivities, {
      poolAddress,
      lpTokenAddress,
    });
    const poolRewardApy = computeRewardsApy(poolRewardActivity?.emissionRate, poolRewardActivity?.totalStakeUsd);
    const weightedApy = weightedBaseYield(
      coinAddresses,
      coinAddresses.map((address: string) =>
        stablePool?.tokenBalances?.get?.(address) || stablePool?.tokenBalances?.get?.(normalizeAddress(address)) || "0"
      ),
      prices,
      baseYieldByAddr
    );

    if (swapApy !== ZERO_APY) {
      const row = { source: "swap" as const, apy: swapApy, meta, poolAddress };
      add(lpTokenAddress, row);
      coinAddresses.forEach((address: string) => add(address, row));
    }
    if (weightedApy) {
      add(lpTokenAddress, { source: "weighted_swap", apy: weightedApy, meta, poolAddress });
    }
    coinAddresses.forEach((address: string) => {
      const tokenBaseApy = baseYieldByAddr.get(address);
      if (tokenBaseApy && tokenBaseApy > 0) {
        add(address, { source: "base", apy: tokenBaseApy.toFixed(2), meta, poolAddress });
      }
    });
    if (poolRewardApy) {
      const rewardRow = { source: "rewards" as const, apy: poolRewardApy, meta, poolAddress };
      add(lpTokenAddress, rewardRow);
      coinAddresses.forEach((address: string) => add(address, rewardRow));
    }
  }

  if (shareTokenAddress) {
    if (vaultAPY && vaultAPY !== "-" && parseFloat(vaultAPY) > 0) {
      add(shareTokenAddress, { source: "vault", apy: vaultAPY });
    }
    if (vaultWeightedApy && parseFloat(vaultWeightedApy) > 0) {
      add(shareTokenAddress, { source: "vault_weighted", apy: vaultWeightedApy });
    }
    if (vaultRewardApy && parseFloat(vaultRewardApy) > 0) {
      add(shareTokenAddress, { source: "rewards", apy: vaultRewardApy, meta: "vault" });
    }
  }

  const safetyAPY = computeSafetyAPY(smRow, stRow, smEvents);
  if (safetyAPY) add(constants.USDST, { source: "safety", apy: safetyAPY });

  return [...map.entries()].map(([token, apys]) => ({ token, apys }));
};

function computeLendingAPY(lp: any, cfg: any, availableLiquidity: string): string | null {
  const { supplyAPY: maxSupplyAPY } = calculateAPYs(cfg.interestRate ?? 0, cfg.reserveFactor ?? 1000);
  const debt = BigInt(totalDebtFromScaled(lp.totalScaledDebt || "0", lp.borrowIndex || "0"));
  const cash = BigInt(availableLiquidity);
  const reserves = BigInt(lp.reservesAccrued || "0");
  const total = cash + debt;
  const denom = total - (reserves < total ? reserves : total);
  const util = denom > 0n ? Number(debt * 10000n / denom) / 100 : 0;
  const apy = maxSupplyAPY * (util / 100);
  return apy > 0 ? apy.toFixed(2) : null;
}

function computeSafetyAPY(smRow: any, stRow: any, events: any[]): string | null {
  const totalAssetsNow = BigInt(smRow?._managedAssets || "0");
  const totalSharesNow = BigInt(stRow?._totalSupply || "0");
  if (totalSharesNow <= 0n) return null;

  let assetsDelta = 0n, sharesDelta = 0n;
  for (const e of events) {
    const a = e.attributes;
    switch (e.event_name) {
      case "Staked":          assetsDelta += BigInt(a.assetsIn || "0"); sharesDelta += BigInt(a.sharesOut || "0"); break;
      case "Redeemed":        assetsDelta -= BigInt(a.assetsOut || "0"); sharesDelta -= BigInt(a.sharesIn || "0"); break;
      case "RewardNotified":  assetsDelta += BigInt(a.amount || "0"); break;
      case "ShortfallCovered": assetsDelta -= BigInt(a.amount || "0"); break;
    }
  }

  const totalAssetsStart = totalAssetsNow - assetsDelta;
  const totalSharesStart = totalSharesNow - sharesDelta;
  if (totalSharesStart <= 0n || totalAssetsStart <= 0n) return null;

  const rateNow = Number(totalAssetsNow) / Number(totalSharesNow);
  const rateStart = Number(totalAssetsStart) / Number(totalSharesStart);
  const periodReturn = rateNow / rateStart - 1;
  if (periodReturn <= -1 || !isFinite(periodReturn)) return null;

  return ((Math.pow(1 + periodReturn, 365 / 30) - 1) * 100).toFixed(2);
}

function buildVolumeMap(swapEvents: any[], prices: Map<string, string>): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of swapEvents) {
    const tokenIn = e.attributes?.tokenIn || e.tokenIn;
    const amountIn = e.attributes?.amountIn || e.amountIn || "0";
    const price = BigInt(prices.get(tokenIn) || "0");
    const volUSD = Number((BigInt(amountIn) * price) / DECIMALS) / 1e18;
    map.set(e.address, (map.get(e.address) || 0) + volUSD);
  }
  return map;
}

function computePoolAPY(pool: any, prices: Map<string, string>, volumeMap: Map<string, number>): string {
  const vol = volumeMap.get(pool.address) || 0;
  const feeRate = pool.swapFeeRate || 30;
  const lpShare = pool.lpSharePercent || 7000;
  const lpFees = vol * (feeRate / 10000) * (lpShare / 10000);
  const priceA = BigInt(prices.get(pool.tokenA.address) || "0");
  const priceB = BigInt(prices.get(pool.tokenB.address) || "0");
  const tvl = Number((BigInt(pool.tokenABalance || "0") * priceA + BigInt(pool.tokenBBalance || "0") * priceB) / DECIMALS) / 1e18;
  const apy = tvl > 0 ? (lpFees / tvl) * 365 * 100 : 0;
  return apy.toFixed(2);
}

function weightedBaseYield(addrs: string[], bals: string[], prices: Map<string, string>, baseYields: Map<string, number>): string | null {
  let ws = 0, total = 0;
  for (let i = 0; i < addrs.length; i++) {
    const usd = Number((safeBigInt(bals[i]) * safeBigInt(prices.get(addrs[i]))) / DECIMALS) / 1e18;
    total += usd;
    ws += usd * (baseYields.get(addrs[i]) || 0);
  }
  return total > 0 && ws > 0 ? (ws / total).toFixed(2) : null;
}

async function getCurrentVaultBalances(
  accessToken: string,
  assets: string[],
  botExecutor: string,
): Promise<Map<string, string>> {
  if (assets.length === 0) return new Map();
  const { data } = await cirrus.get(accessToken, "/mapping", { params: {
    address: `in.(${assets.join(",")})`,
    collection_name: "eq._balances",
    "key->>key": `eq.${botExecutor}`,
    select: "address,value::text",
  }});
  return new Map((data || []).map((row: any) => [row.address, row.value || "0"]));
}

async function getTokenTotalSupply(accessToken: string, tokenAddress: string): Promise<string> {
  try {
    const { data } = await cirrus.get(accessToken, `/${Token}`, { params: {
      select: "_totalSupply::text",
      address: `eq.${tokenAddress}`,
    }});
    return data?.[0]?._totalSupply || "0";
  } catch {
    return "0";
  }
}

function buildRewardActivitiesFromMappings(
  activityCfgById: Map<string, any>,
  activityStateById: Map<string, any>,
  pricingCtx: {
    priceMap: Map<string, string>;
    mTokenAddress: string | null;
    sTokenAddress: string | null;
    vaultShareTokenAddress: string | null;
    saveUsdstVaultAddress: string | null;
  }
): any[] {
  const activities: any[] = [];
  for (const [activityId, activity] of activityCfgById.entries()) {
    const state = activityStateById.get(activityId);
    const sourceContract = String(activity?.sourceContract || "");
    const totalStake = String(state?.totalStake || "0");
    const name = String(activity?.name || "");
    const emissionRate = String(activity?.emissionRate || "0");

    const { stakeAssetAddress, totalStakeUsd } = computeRewardStakeUsd(
      sourceContract,
      name,
      totalStake,
      pricingCtx
    );

    activities.push({
      activityId: Number(activityId),
      name,
      emissionRate,
      sourceContract,
      stakeAssetAddress,
      totalStake,
      totalStakeUsd,
    });
  }
  return activities;
}

function computeRewardStakeUsd(
  sourceContractRaw: string,
  name: string,
  totalStake: string,
  ctx: {
    priceMap: Map<string, string>;
    mTokenAddress: string | null;
    sTokenAddress: string | null;
    vaultShareTokenAddress: string | null;
    saveUsdstVaultAddress: string | null;
  }
): { stakeAssetAddress: string | null; totalStakeUsd: string | null } {
  const sourceContract = normalizeAddress(sourceContractRaw);
  const saveUsdstSource = normalizeAddress(ctx.saveUsdstVaultAddress);

  const isUsdNotional =
    USD_NOTIONAL_SWAP_SOURCES.has(sourceContract) ||
    USD_NOTIONAL_DEPOSIT_COMPLETED_SOURCES.has(sourceContract) ||
    USD_NOTIONAL_AMOUNT_USD_SOURCES.has(sourceContract);
  if (isUsdNotional) {
    return { stakeAssetAddress: null, totalStakeUsd: totalStake || "0" };
  }

  const stakeAssetAddress =
    TOKEN_UNITS_SOURCES.has(sourceContract) || (saveUsdstSource && sourceContract === saveUsdstSource)
      ? sourceContract
      : null;

  const directStakePrice = stakeAssetAddress ? getPriceForAddress(ctx.priceMap, stakeAssetAddress) : null;
  if (directStakePrice) {
    return { stakeAssetAddress, totalStakeUsd: toUsdValue(totalStake, directStakePrice) };
  }

  const lower = (name || "").toLowerCase();
  if (lower.includes("safety")) {
    const sTokenPrice = getPriceForAddress(ctx.priceMap, ctx.sTokenAddress);
    if (sTokenPrice) return { stakeAssetAddress, totalStakeUsd: toUsdValue(totalStake, sTokenPrice) };
  }

  if (lower.includes("lending pool liquidity")) {
    const mTokenPrice = getPriceForAddress(ctx.priceMap, ctx.mTokenAddress);
    if (mTokenPrice) return { stakeAssetAddress, totalStakeUsd: toUsdValue(totalStake, mTokenPrice) };
  }

  if (lower.includes("borrow")) {
    return { stakeAssetAddress, totalStakeUsd: totalStake || "0" };
  }

  if (lower.includes("vault")) {
    const vaultPrice = getPriceForAddress(ctx.priceMap, ctx.vaultShareTokenAddress);
    if (vaultPrice) return { stakeAssetAddress, totalStakeUsd: toUsdValue(totalStake, vaultPrice) };
  }

  return { stakeAssetAddress, totalStakeUsd: null };
}

function getPriceForAddress(priceMap: Map<string, string>, address?: string | null): string | null {
  if (!address) return null;
  const normalized = normalizeAddress(address);
  const raw = String(address);
  return (
    priceMap.get(raw) ||
    priceMap.get(normalized) ||
    priceMap.get(raw.toLowerCase()) ||
    null
  );
}

function toUsdValue(amountWei: string, priceWei: string): string {
  const amount = BigInt(amountWei || "0");
  const price = BigInt(priceWei || "0");
  if (amount === 0n || price === 0n) return "0";
  return ((amount * price) / DECIMALS).toString();
}

function parseMappingValue(raw: string): any | null {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function computeRewardsApy(emissionRateRaw?: string, totalStakeUsdRaw?: string | null): string | null {
  try {
    if (!emissionRateRaw || !totalStakeUsdRaw) return null;
    const emissionRate = BigInt(emissionRateRaw);
    const totalStakeUsd = BigInt(totalStakeUsdRaw);
    if (emissionRate <= 0n || totalStakeUsd <= 0n) return null;

    const tvlUsd = Number(totalStakeUsd) / 1e18;
    const annualCata = (Number(emissionRate) / 1e18) * 86400 * 365;
    if (!isFinite(tvlUsd) || tvlUsd <= 0 || !isFinite(annualCata) || annualCata <= 0) return null;

    const apy = ((annualCata * CATA_PRICE_USD) / tvlUsd) * 100;
    return apy > 0 && isFinite(apy) ? apy.toFixed(2) : null;
  } catch {
    return null;
  }
}

function normalizeAddress(value?: string | null): string {
  return (value || "").toLowerCase().replace(/^0x/, "");
}

function findRewardActivity(
  activities: any[],
  options: {
    sourceContract?: string | null;
    stakeAssetAddress?: string | null;
    nameIncludes?: string[];
  }
): any | null {
  const normalizedSource = normalizeAddress(options.sourceContract);
  const normalizedStakeAsset = normalizeAddress(options.stakeAssetAddress);
  const nameMatchers = (options.nameIncludes || []).map((name) => name.toLowerCase());

  const matches = activities.filter((activity) => {
    const source = normalizeAddress(activity?.sourceContract);
    const stakeAsset = normalizeAddress(activity?.stakeAssetAddress);
    const name = String(activity?.name || "").toLowerCase();

    if (normalizedSource && source !== normalizedSource) return false;
    if (normalizedStakeAsset && stakeAsset && stakeAsset !== normalizedStakeAsset) return false;
    if (nameMatchers.length > 0 && !nameMatchers.some((matcher) => name.includes(matcher))) return false;
    return true;
  });

  if (matches.length === 0) return null;

  const exactStakeAssetMatch = matches.find(
    (activity) => normalizedStakeAsset && normalizeAddress(activity?.stakeAssetAddress) === normalizedStakeAsset
  );
  if (exactStakeAssetMatch) return exactStakeAssetMatch;

  const withUsdStake = matches.find((activity) => safeBigInt(activity?.totalStakeUsd || "0") > 0n);
  return withUsdStake || matches[0];
}

function findPoolRewardActivity(
  activities: any[],
  options: {
    poolAddress?: string | null;
    lpTokenAddress?: string | null;
  }
): any | null {
  const normalizedPool = normalizeAddress(options.poolAddress);
  const normalizedLpToken = normalizeAddress(options.lpTokenAddress);

  const matches = activities.filter((activity) => {
    const source = normalizeAddress(activity?.sourceContract);
    const stakeAsset = normalizeAddress(activity?.stakeAssetAddress);
    return (
      (normalizedPool && source === normalizedPool) ||
      (normalizedLpToken && source === normalizedLpToken) ||
      (normalizedLpToken && stakeAsset === normalizedLpToken)
    );
  });

  if (matches.length === 0) return null;

  const exactLpStakeMatch = matches.find(
    (activity) => normalizedLpToken && normalizeAddress(activity?.stakeAssetAddress) === normalizedLpToken
  );
  if (exactLpStakeMatch) return exactLpStakeMatch;

  const exactPoolSourceMatch = matches.find(
    (activity) => normalizedPool && normalizeAddress(activity?.sourceContract) === normalizedPool
  );
  if (exactPoolSourceMatch) return exactPoolSourceMatch;

  const withUsdStake = matches.find((activity) => safeBigInt(activity?.totalStakeUsd || "0") > 0n);
  return withUsdStake || matches[0];
}
