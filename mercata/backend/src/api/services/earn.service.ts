import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { hiddenSwapPools, yieldBenchmarks, compositeYieldMap, rewards as rewardsAddr, saveUsdstVault as saveUsdstVaultAddr } from "../../config/config";
import { toUTCTime } from "../helpers/cirrusHelpers";
import {
  computeExchangeRateAPY, getYieldWindowBounds, getYieldExchangeRateRowsCached,
  indexYieldHistoryRows, mergeBackfillRows,
  ZERO_APY, DEFAULT_SWAP_FEE_BPS, DEFAULT_LP_SHARE_BPS,
  computeLendingAPY, computeSafetyAPY, computePoolAPY, weightedBaseYield, buildVolumeMap,
} from "../helpers/earnYield.helper";
import { calculateLPTokenPrice, fetchMultiTokenStablePools, fetchStablePoolFees } from "../helpers/swapping.helper";
import {
  normalizeAddress, isPositiveApy, parseMappingValue, toUsdValue, APY_UNAVAILABLE,
  buildRewardActivitiesFromMappings, computeRewardsApy,
  findRewardActivity, findPoolRewardActivity,
} from "../helpers/earnRewards.helper";
import { computeEquityFromMaps, computeVaultPerformanceMetrics, safeBigInt } from "../helpers/vaultPerformance.helper";
import { ApySource, TokenApyEntry } from "@mercata/shared-types";

// ── Constants ─────────────────────────────────────────────────────────────────

const { Pool, DECIMALS, Token, ZERO_ADDRESS, DAY_MS, BPS_DIVISOR } = constants;
const SAVE_USDST_APY_TTL_MS = 60_000;

const firstSaveUsdstDepositCache = new Map<string, { timestamp: Date } | null>();
const saveUsdstApyCache = new Map<string, { value: string; expiry: number }>();

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase1Data = Awaited<ReturnType<typeof fetchPhase1>>;
type Phase1Ctx = ReturnType<typeof parsePhase1>;
type Phase1bData = Awaited<ReturnType<typeof fetchPhase1b>>;
type AddFn = (token: string, entry: ApySource) => void;

// ── Main ──────────────────────────────────────────────────────────────────────

export const getTokenApys = async (accessToken: string): Promise<TokenApyEntry[]> => {
  const now = Date.now();
  const { windowStart, windowEndExclusive, anchorsMs } = getYieldWindowBounds(now);
  const vaultAddr = constants.vault ?? "";
  const rewAddr = rewardsAddr ?? "";
  const saveUsdstVault = saveUsdstVaultAddr ?? "";

  const phase1 = await fetchPhase1(accessToken, now, windowStart, windowEndExclusive, anchorsMs, vaultAddr, rewAddr, saveUsdstVault);
  const ctx = parsePhase1(phase1, vaultAddr, rewAddr, saveUsdstVault);
  const phase1b = await fetchPhase1b(accessToken, ctx, saveUsdstVault);

  const rewardActivities = buildRewardActivitiesFromMappings(
    ctx.rewardActivityCfgById, ctx.rewardActivityStateById, {
      priceMap: ctx.prices,
      mTokenAddress: ctx.lpData?.mToken ?? null,
      sTokenAddress: constants.sToken ?? null,
      vaultShareTokenAddress: ctx.shareTokenAddress || null,
      saveUsdstVaultAddress: saveUsdstVault || null,
    },
  );

  const { vaultAPY, vaultRewardApy } = await computeVaultApys(
    accessToken, vaultAddr, ctx, phase1b, rewardActivities,
  );

  const map = new Map<string, ApySource[]>();
  const add: AddFn = (t, e) => { const arr = map.get(t); if (arr) arr.push(e); else map.set(t, [e]); };

  addLendingApys(add, ctx, rewardActivities);
  addDirectMintRewards(add, rewardActivities);
  addSaveUsdstApys(add, ctx, phase1b, rewardActivities, saveUsdstVault);

  const exchangeRateHistory = indexYieldHistoryRows(mergeBackfillRows(phase1.exchangeRateRows ?? []));
  const baseYieldByAddr = addBaseYieldApys(add, exchangeRateHistory, anchorsMs);

  await addPoolApys(accessToken, add, phase1.pools, phase1b.stablePools, ctx, rewardActivities, baseYieldByAddr);

  if (ctx.shareTokenAddress) {
    if (isPositiveApy(vaultAPY)) add(ctx.shareTokenAddress, { source: "vault", apy: vaultAPY });
    if (isPositiveApy(vaultRewardApy)) add(ctx.shareTokenAddress, { source: "rewards", apy: vaultRewardApy, meta: "vault" });
  }

  const safetyAPY = computeSafetyAPY(ctx.smRow, ctx.stRow, ctx.smEvents);
  if (safetyAPY) add(constants.USDST, { source: "safety", apy: safetyAPY });

  return [...map.entries()].map(([token, apys]) => ({ token, apys }));
};

// ── Phase 1: parallel Cirrus queries ──────────────────────────────────────────

async function fetchPhase1(
  accessToken: string, now: number,
  windowStart: string, windowEndExclusive: string, anchorsMs: number[],
  vaultAddr: string, rewardsAddr: string, saveUsdstVault: string,
) {
  const twentyFourHoursAgo = toUTCTime(new Date(now - DAY_MS));
  const thirtyDaysAgo = toUTCTime(new Date(now - 30 * DAY_MS));

  const mappingFilters = [
    `and(address.eq.${constants.lendingPool},collection_name.eq.assetConfigs,key->>key.eq.${constants.USDST})`,
    `and(address.eq.${constants.USDST},collection_name.eq._balances,key->>key.eq.${constants.liquidityPool})`,
    `and(address.eq.${constants.priceOracle},collection_name.eq.prices)`,
  ];
  if (vaultAddr) mappingFilters.push(`and(address.eq.${vaultAddr},collection_name.eq.supportedAssets)`);
  if (rewardsAddr) mappingFilters.push(`and(address.eq.${rewardsAddr},collection_name.in.(activities,activityStates))`);
  if (saveUsdstVault) mappingFilters.push(`and(address.eq.${constants.USDST},collection_name.eq._balances,key->>key.eq.${saveUsdstVault})`);

  const storageAddrs = [constants.lendingPool, constants.safetyModule, constants.sToken, vaultAddr, saveUsdstVault].filter(Boolean);

  const exchangeRateAddrs = [
    ...yieldBenchmarks.map(b => b.tokenAddress),
    ...Object.values(compositeYieldMap),
  ];

  const [
    { data: storageRows },
    { data: mappingRows },
    { data: eventRows },
    { data: pools },
    exchangeRateRows,
  ] = await Promise.all([
    cirrus.get(accessToken, "/storage", { params: {
      address: `in.(${storageAddrs.join(",")})`,
      select: "address,data->>borrowableAsset,data->>mToken,data->>totalScaledDebt,data->>borrowIndex,data->>reservesAccrued,data->>_managedAssets,data->>_totalSupply,data->>botExecutor,data->>priceOracle,data->>shareToken,data->>assetToken",
    }}),
    cirrus.get(accessToken, "/mapping", { params: { select: "address,collection_name,key->>key,value::text", or: `(${mappingFilters.join(",")})` } }),
    cirrus.get(accessToken, `/${constants.Event}`, { params: { select: "address,event_name,attributes,block_timestamp", or: `(and(event_name.eq.Swap,block_timestamp.gte.${twentyFourHoursAgo}),and(address.eq.${constants.safetyModule},event_name.in.(Staked,Redeemed,RewardNotified,ShortfallCovered),block_timestamp.gte.${thirtyDaysAgo}))` } }),
    cirrus.get(accessToken, `/${Pool}`, { params: {
      poolFactory: `eq.${constants.poolFactory}`,
      select: "address,tokenA:tokenA_fkey(address,_symbol),tokenB:tokenB_fkey(address,_symbol),lpToken:lpToken_fkey(address,_symbol,_totalSupply::text),tokenABalance::text,tokenBBalance::text,swapFeeRate,lpSharePercent,isPaused,isDisabled,isStable",
    }}),
    getYieldExchangeRateRowsCached(accessToken, {
      priceOracle: constants.priceOracle,
      exchangeRateAddrs,
      windowStart,
      windowEndExclusive,
      anchorsMs,
    }),
  ]);

  return { storageRows, mappingRows, eventRows, pools, exchangeRateRows };
}

// ── Parse Phase 1 ─────────────────────────────────────────────────────────────

function parsePhase1(phase1: Phase1Data, vaultAddr: string, rewardsAddr: string, saveUsdstVault: string) {
  const storageByAddr = new Map((phase1.storageRows ?? []).map((r: any) => [r.address, r]));
  const lpData: any = storageByAddr.get(constants.lendingPool);
  const smRow = storageByAddr.get(constants.safetyModule);
  const stRow = storageByAddr.get(constants.sToken);
  const vaultStorage: any = vaultAddr ? storageByAddr.get(vaultAddr) : null;
  const botExecutor = vaultStorage?.botExecutor;
  const shareTokenAddress = vaultStorage?.shareToken ?? "";
  const saveUsdstStorage: any = saveUsdstVault ? storageByAddr.get(saveUsdstVault) : null;

  const prices = new Map<string, string>();
  let lendingCfg: any = null;
  let liqBalance: string | null = null;
  let saveUsdstBalance: string | null = null;
  const vaultAssets: string[] = [];
  const rewardActivityCfgById = new Map<string, any>();
  const rewardActivityStateById = new Map<string, any>();
  const rewardsAddrNorm = rewardsAddr ? normalizeAddress(rewardsAddr) : "";

  for (const r of phase1.mappingRows ?? []) {
    if (r.collection_name === "prices") prices.set(r.key, r.value);
    else if (r.collection_name === "assetConfigs") lendingCfg = JSON.parse(r.value);
    else if (r.collection_name === "_balances" && r.key === constants.liquidityPool) liqBalance = r.value;
    else if (r.collection_name === "_balances" && saveUsdstVault && r.key === saveUsdstVault) saveUsdstBalance = r.value;
    else if (r.collection_name === "supportedAssets" && r.value) {
      const addr = r.value.replace(/"/g, "");
      if (addr) vaultAssets.push(addr);
    } else if (rewardsAddrNorm && normalizeAddress(r.address) === rewardsAddrNorm && r.value) {
      const parsed = parseMappingValue(r.value);
      if (!parsed) continue;
      const activityId = String(r.key ?? "");
      if (!activityId) continue;
      if (r.collection_name === "activities") rewardActivityCfgById.set(activityId, parsed);
      else if (r.collection_name === "activityStates") rewardActivityStateById.set(activityId, parsed);
    }
  }

  const filteredVaultAssets = vaultAssets.filter(a => a !== ZERO_ADDRESS);

  const swapEvents: any[] = [], smEvents: any[] = [];
  for (const e of phase1.eventRows ?? []) {
    switch (e.event_name) {
      case "Swap": swapEvents.push(e); break;
      case "Staked": case "Redeemed": case "RewardNotified": case "ShortfallCovered": smEvents.push(e); break;
    }
  }

  for (const p of phase1.pools ?? []) {
    if (p.lpToken?.address && p.lpToken._totalSupply) {
      const lpPrice = calculateLPTokenPrice(
        p.tokenABalance ?? "0", p.tokenBBalance ?? "0",
        prices.get(p.tokenA?.address) ?? "0", prices.get(p.tokenB?.address) ?? "0",
        p.lpToken._totalSupply,
      );
      if (lpPrice !== "0") prices.set(p.lpToken.address, lpPrice);
    }
  }

  return {
    lpData, smRow, stRow, vaultStorage, botExecutor, shareTokenAddress,
    saveUsdstStorage, saveUsdstBalance,
    prices, lendingCfg, liqBalance, filteredVaultAssets,
    rewardActivityCfgById, rewardActivityStateById,
    swapEvents, smEvents,
  };
}

// ── Phase 1b: dependent parallel reads ────────────────────────────────────────

async function fetchPhase1b(accessToken: string, ctx: Phase1Ctx, saveUsdstVault: string) {
  const saveUsdstAsset = ctx.saveUsdstStorage?.assetToken ?? constants.USDST;
  const saveUsdstManagedAssets = safeBigInt(ctx.saveUsdstStorage?._managedAssets);
  const saveUsdstTotalShares = safeBigInt(ctx.saveUsdstStorage?._totalSupply);
  const vaultAddr = constants.vault;

  const [stablePools, shareTokenTotalSupply, vaultBalanceRows, saveUsdstApyResult] = await Promise.all([
    fetchMultiTokenStablePools(accessToken).catch(() => []),
    ctx.shareTokenAddress
      ? (async () => {
          const { data: rows } = await cirrus.get(accessToken, "/storage", { params: {
            address: `eq.${ctx.shareTokenAddress}`,
            select: "data->>_totalSupply",
          }}).catch(() => ({ data: [] as any[] }));
          return rows?.[0]?._totalSupply || await getTokenTotalSupply(accessToken, ctx.shareTokenAddress);
        })()
      : Promise.resolve("0"),
    (vaultAddr && ctx.shareTokenAddress && ctx.botExecutor && ctx.filteredVaultAssets.length)
      ? cirrus.get(accessToken, "/mapping", { params: {
          address: `in.(${ctx.filteredVaultAssets.join(",")})`,
          collection_name: "eq._balances",
          "key->>key": `eq.${ctx.botExecutor}`,
          select: "address,value::text",
        }}).then(res => res.data ?? []).catch(() => [])
      : Promise.resolve([] as any[]),
    computeSaveUsdstApy(accessToken, saveUsdstVault, saveUsdstAsset, safeBigInt(ctx.saveUsdstBalance), saveUsdstManagedAssets, saveUsdstTotalShares),
  ]);

  return { stablePools, shareTokenTotalSupply, vaultBalanceRows, saveUsdstApyResult, saveUsdstManagedAssets, saveUsdstTotalShares, saveUsdstAsset };
}

// ── Phase 2: vault APY ────────────────────────────────────────────────────────

async function computeVaultApys(
  accessToken: string, vaultAddr: string, ctx: Phase1Ctx, phase1b: Phase1bData, rewardActivities: any[],
) {
  let vaultAPY: string | null = null;
  let vaultRewardApy: string | null = null;
  const currentVaultBalances = new Map<string, string>();
  for (const row of phase1b.vaultBalanceRows ?? []) currentVaultBalances.set(row.address, row.value ?? "0");

  if (vaultAddr && ctx.shareTokenAddress && ctx.botExecutor && ctx.filteredVaultAssets.length) {
    const vaultEquity = computeEquityFromMaps(ctx.filteredVaultAssets, currentVaultBalances, ctx.prices);
    const vaultTotalShares = safeBigInt(phase1b.shareTokenTotalSupply ?? "0");

    const vaultMetrics = await computeVaultPerformanceMetrics(
      accessToken, vaultAddr, vaultEquity, vaultTotalShares, ctx.shareTokenAddress,
      ctx.botExecutor, ctx.vaultStorage?.priceOracle ?? constants.priceOracle,
      ctx.filteredVaultAssets, ctx.prices,
    );

    vaultAPY = vaultMetrics.apy !== APY_UNAVAILABLE ? vaultMetrics.apy : null;
    const vaultRewardsActivity = findRewardActivity(rewardActivities, {
      sourceContract: ctx.shareTokenAddress,
      stakeAssetAddress: ctx.shareTokenAddress,
      nameIncludes: ["vault"],
    });
    if (vaultRewardsActivity && !vaultRewardsActivity.totalStakeUsd && vaultTotalShares > 0n && vaultEquity > 0n) {
      const sharePrice = ((vaultEquity * DECIMALS) / vaultTotalShares).toString();
      vaultRewardsActivity.totalStakeUsd = toUsdValue(vaultRewardsActivity.totalStake ?? "0", sharePrice);
    }
    vaultRewardApy = computeRewardsApy(vaultRewardsActivity?.emissionRate, vaultRewardsActivity?.totalStakeUsd);
  }

  return { vaultAPY, vaultRewardApy };
}

// ── APY assembly helpers ──────────────────────────────────────────────────────

function addLendingApys(add: AddFn, ctx: Phase1Ctx, rewardActivities: any[]) {
  const { lpData, lendingCfg, liqBalance } = ctx;
  if (!lpData?.borrowableAsset || !lendingCfg || !liqBalance) return;

  const targets = [lpData.borrowableAsset, lpData.mToken].filter(Boolean);

  const lendingAPY = computeLendingAPY(lpData, lendingCfg, liqBalance);
  if (lendingAPY) for (const t of targets) add(t, { source: "lending", apy: lendingAPY });

  const mTokenNorm = normalizeAddress(lpData.mToken);
  const lendingRewardsActivity = rewardActivities.find(a => {
    const name = String(a?.name ?? "").toLowerCase();
    return name.includes("lending pool liquidity") || (!!mTokenNorm && a._srcNorm === mTokenNorm);
  }) ?? null;
  const lendingRewardsApy = computeRewardsApy(lendingRewardsActivity?.emissionRate, lendingRewardsActivity?.totalStakeUsd);
  if (lendingRewardsApy) for (const t of targets) add(t, { source: "rewards", apy: lendingRewardsApy, meta: "lending" });
}

function addDirectMintRewards(add: AddFn, rewardActivities: any[]) {
  const activity = findRewardActivity(rewardActivities, { sourceContract: constants.mercataBridge });
  const apy = computeRewardsApy(activity?.emissionRate, activity?.totalStakeUsd);
  if (apy) add(constants.USDST, { source: "rewards", apy, meta: "direct_mint" });
}

function addSaveUsdstApys(add: AddFn, ctx: Phase1Ctx, phase1b: Phase1bData, rewardActivities: any[], saveUsdstVault: string) {
  const addr = normalizeAddress(saveUsdstVault);
  if (!addr) return;

  const nativeApy = isPositiveApy(phase1b.saveUsdstApyResult) ? phase1b.saveUsdstApyResult : null;

  const liveBalance = safeBigInt(ctx.saveUsdstBalance);
  const pricingAssets = liveBalance < phase1b.saveUsdstManagedAssets ? liveBalance : phase1b.saveUsdstManagedAssets;
  const assetPrice = safeBigInt(ctx.prices.get(phase1b.saveUsdstAsset) ?? ctx.prices.get(constants.USDST));
  const tvlUsd = assetPrice > 0n ? (pricingAssets * assetPrice) / DECIMALS : 0n;
  const stakeUsd = tvlUsd > 0n ? tvlUsd.toString() : pricingAssets > 0n ? pricingAssets.toString() : null;

  const rewardsActivity = findRewardActivity(rewardActivities, {
    sourceContract: addr, stakeAssetAddress: addr, nameIncludes: ["save usdst", "saveusdst"],
  });
  const rewardsApy = computeRewardsApy(rewardsActivity?.emissionRate, rewardsActivity?.totalStakeUsd ?? stakeUsd);

  if (nativeApy) add(addr, { source: "lending", apy: nativeApy, meta: "save_usdst" });
  if (rewardsApy) add(addr, { source: "rewards", apy: rewardsApy, meta: "save_usdst" });
}

function addBaseYieldApys(add: AddFn, exchangeRateHistory: any, anchorsMs: number[]): Map<string, number> {
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
  return baseYieldByAddr;
}

/** StablePool.fee raw (1e10 scale) → bps (10000 scale) */
const STABLE_FEE_TO_BPS = 1_000_000n;

async function addPoolApys(
  accessToken: string,
  add: AddFn, pools: any[], stablePools: any[],
  ctx: Phase1Ctx, rewardActivities: any[], baseYieldByAddr: Map<string, number>,
) {
  const volumeMap = buildVolumeMap(ctx.swapEvents, ctx.prices);
  const firstPool = (pools ?? [])[0];
  const factoryLpSharePercent = Number(firstPool?.lpSharePercent || DEFAULT_LP_SHARE_BPS);
  const stablePoolAddresses = new Set(
    (stablePools ?? []).map((pool: any) => normalizeAddress(pool?.address)).filter(Boolean),
  );

  // Fetch real on-chain fees for 2-token stable pools
  const twoTokenStableAddrs = (pools ?? []).filter((p: any) => p?.isStable && p?.address).map((p: any) => p.address as string);
  const stableFeeBps = twoTokenStableAddrs.length
    ? await fetchStablePoolFees(accessToken, twoTokenStableAddrs).catch(() => new Map<string, number>())
    : new Map<string, number>();

  const tokenSymbolMap = new Map<string, string>();
  for (const p of pools ?? []) {
    if (p.tokenA?.address) tokenSymbolMap.set(normalizeAddress(p.tokenA.address), p.tokenA._symbol);
    if (p.tokenB?.address) tokenSymbolMap.set(normalizeAddress(p.tokenB.address), p.tokenB._symbol);
  }

  const activePools = (pools ?? []).filter((p: any) =>
    p.tokenA?.address && p.tokenB?.address && p.lpToken?.address &&
    !p.isPaused && !p.isDisabled &&
    !(p.tokenABalance === "0" && p.tokenBBalance === "0") &&
    !hiddenSwapPools.has(p.address) &&
    !stablePoolAddresses.has(normalizeAddress(p.address))
  );

  for (const p of activePools) {
    const { tokenA, tokenB, lpToken, tokenABalance, tokenBBalance, address } = p;
    const meta = `${tokenA._symbol}-${tokenB._symbol}`;
    const poolAddress = normalizeAddress(address);
    const lpTokenAddress = lpToken.address;
    const tokenAddrs = [tokenA.address, tokenB.address];
    const realFee = stableFeeBps.get(address);
    const poolForApy = realFee !== undefined ? { ...p, swapFeeRate: realFee } : p;
    const swapApy = computePoolAPY(poolForApy, ctx.prices, volumeMap);
    const rewardActivity = findPoolRewardActivity(rewardActivities, { poolAddress, lpTokenAddress });
    const poolRewardApy = computeRewardsApy(rewardActivity?.emissionRate, rewardActivity?.totalStakeUsd);
    const wApy = baseYieldByAddr.size > 0
      ? weightedBaseYield(tokenAddrs, [tokenABalance ?? "0", tokenBBalance ?? "0"], ctx.prices, baseYieldByAddr)
      : null;

    emitPoolApys(add, poolAddress, lpTokenAddress, meta, tokenAddrs, swapApy, poolRewardApy, wApy, baseYieldByAddr);
  }

  for (const stablePool of stablePools ?? []) {
    const poolAddress = normalizeAddress(stablePool?.address);
    const lpTokenAddress = stablePool?.lpToken;
    const tokenAddrs: string[] = (stablePool?.coins ?? []).map((coin: any) => coin?.tokenAddress).filter(Boolean);
    if (!poolAddress || !lpTokenAddress || tokenAddrs.length === 0 || hiddenSwapPools.has(poolAddress)) continue;

    const meta = tokenAddrs.map(a => tokenSymbolMap.get(normalizeAddress(a))).filter(Boolean).join("-");

    let totalTvlUsd = 0;
    const balances: string[] = [];
    for (const address of tokenAddrs) {
      const addrNorm = normalizeAddress(address);
      const bal = stablePool?.tokenBalances?.get?.(address) ?? stablePool?.tokenBalances?.get?.(addrNorm) ?? "0";
      balances.push(bal);
      const priceRaw = ctx.prices.get(address) ?? ctx.prices.get(addrNorm) ?? "0";
      totalTvlUsd += Number((BigInt(bal) * BigInt(priceRaw)) / DECIMALS) / 1e18;
    }

    const feeRaw = BigInt(String(stablePool.fee || "0"));
    const swapFeeBps = feeRaw > 0n ? Number(feeRaw / STABLE_FEE_TO_BPS) : DEFAULT_SWAP_FEE_BPS;
    const volume24h = volumeMap.get(stablePool.address) ?? volumeMap.get(poolAddress) ?? 0;
    const swapApyValue = totalTvlUsd > 0
      ? (volume24h * (swapFeeBps / BPS_DIVISOR) * (factoryLpSharePercent / BPS_DIVISOR) / totalTvlUsd) * 365 * 100
      : 0;
    const swapApy = swapApyValue > 0 ? swapApyValue.toFixed(2) : ZERO_APY;
    const rewardActivity = findPoolRewardActivity(rewardActivities, { poolAddress, lpTokenAddress });
    const poolRewardApy = computeRewardsApy(rewardActivity?.emissionRate, rewardActivity?.totalStakeUsd);
    const wApy = weightedBaseYield(tokenAddrs, balances, ctx.prices, baseYieldByAddr);

    emitPoolApys(add, poolAddress, lpTokenAddress, meta, tokenAddrs, swapApy, poolRewardApy, wApy, baseYieldByAddr);
  }
}

function emitPoolApys(
  add: AddFn, poolAddress: string, lpTokenAddress: string, meta: string, tokenAddrs: string[],
  swapApy: string, poolRewardApy: string | null, wApy: string | null, baseYieldByAddr: Map<string, number>,
) {
  const broadcast = (row: ApySource) => { add(lpTokenAddress, row); for (const t of tokenAddrs) add(t, row); };

  if (swapApy !== ZERO_APY) broadcast({ source: "swap", apy: swapApy, meta, poolAddress });
  if (wApy) add(lpTokenAddress, { source: "weighted_swap", apy: wApy, meta, poolAddress });
  for (const addr of tokenAddrs) {
    const base = baseYieldByAddr.get(addr);
    if (base && base > 0) add(addr, { source: "base", apy: base.toFixed(2), meta, poolAddress });
  }
  if (poolRewardApy) broadcast({ source: "rewards", apy: poolRewardApy, meta, poolAddress });
}

// ── Cirrus helpers ────────────────────────────────────────────────────────────

async function getTokenTotalSupply(accessToken: string, tokenAddress: string): Promise<string> {
  try {
    const { data } = await cirrus.get(accessToken, `/${Token}`, { params: {
      select: "_totalSupply::text",
      address: `eq.${tokenAddress}`,
    }});
    return data?.[0]?._totalSupply ?? "0";
  } catch {
    return "0";
  }
}

// ── SaveUSDST APY (with 60s TTL cache) ───────────────────────────────────────

async function computeSaveUsdstApy(
  accessToken: string, vaultAddress: string | undefined, assetAddress: string,
  liveBalance: bigint, managedAssets: bigint, totalShares: bigint,
): Promise<string> {
  if (!vaultAddress || totalShares <= 0n) return ZERO_APY;

  const cached = saveUsdstApyCache.get(vaultAddress);
  if (cached && cached.expiry > Date.now()) return cached.value;

  const pricingAssets = liveBalance < managedAssets ? liveBalance : managedAssets;
  if (pricingAssets <= 0n) return ZERO_APY;

  try {
    let firstDeposit = firstSaveUsdstDepositCache.get(vaultAddress);
    if (firstDeposit === undefined) {
      const { data } = await cirrus.get(accessToken, "/event", { params: {
        address: `eq.${vaultAddress}`,
        event_name: "eq.Deposit",
        select: "block_timestamp",
        order: "block_timestamp.asc",
        limit: "1",
      }}).catch(() => ({ data: [] as any[] }));
      firstDeposit = data?.[0]?.block_timestamp ? { timestamp: new Date(data[0].block_timestamp) } : null;
      firstSaveUsdstDepositCache.set(vaultAddress, firstDeposit);
    }
    if (!firstDeposit?.timestamp) return ZERO_APY;

    const nowMs = Date.now();
    const startMs = Math.max(nowMs - 30 * DAY_MS, firstDeposit.timestamp.getTime());
    const lookbackDays = Math.max(1, (nowMs - startMs) / DAY_MS);
    const startTimestamp = new Date(startMs + 1).toISOString();

    const [{ data: histStorageRows }, { data: histBalanceRows }] = await Promise.all([
      cirrus.get(accessToken, "/history@storage", { params: {
        address: `eq.${vaultAddress}`,
        valid_from: `lte.${startTimestamp}`,
        valid_to: `gte.${startTimestamp}`,
        select: "data",
      }}).catch(() => ({ data: [] as any[] })),
      cirrus.get(accessToken, "/history@mapping", { params: {
        select: "value::text",
        address: `eq.${assetAddress}`,
        collection_name: "eq._balances",
        "key->>key": `eq.${vaultAddress}`,
        valid_from: `lte.${startTimestamp}`,
        valid_to: `gte.${startTimestamp}`,
      }}).catch(() => ({ data: [] as any[] })),
    ]);

    const histManagedAssets = safeBigInt(histStorageRows?.[0]?.data?._managedAssets);
    const histTotalShares = safeBigInt(histStorageRows?.[0]?.data?._totalSupply);
    const histBalance = safeBigInt(histBalanceRows?.[0]?.value);
    if (histTotalShares <= 0n) { cacheApyResult(vaultAddress, APY_UNAVAILABLE); return APY_UNAVAILABLE; }

    const histPricingAssets = histBalance < histManagedAssets ? histBalance : histManagedAssets;
    const rateNow = (pricingAssets * DECIMALS) / totalShares;
    const rateStart = histTotalShares > 0n && histPricingAssets > 0n ? (histPricingAssets * DECIMALS) / histTotalShares : 0n;
    if (rateStart <= 0n) { cacheApyResult(vaultAddress, ZERO_APY); return ZERO_APY; }

    const periodReturn = Number(((rateNow - rateStart) * DECIMALS) / rateStart) / 1e18;
    if (!isFinite(periodReturn) || periodReturn <= -1) { cacheApyResult(vaultAddress, APY_UNAVAILABLE); return APY_UNAVAILABLE; }

    const annualizationDays = Math.max(30, lookbackDays);
    const apy = (Math.pow(1 + periodReturn, 365 / annualizationDays) - 1) * 100;
    const result = isFinite(apy) ? apy.toFixed(2) : APY_UNAVAILABLE;
    cacheApyResult(vaultAddress, result);
    return result;
  } catch {
    return APY_UNAVAILABLE;
  }
}

function cacheApyResult(vaultAddress: string, value: string) {
  saveUsdstApyCache.set(vaultAddress, { value, expiry: Date.now() + SAVE_USDST_APY_TTL_MS });
}
