import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { hiddenSwapPools, yieldBenchmarks } from "../../config/config";
import { toUTCTime } from "../helpers/cirrusHelpers";
import { totalDebtFromScaled, calculateAPYs } from "../helpers/lending.helper";
import { ApySource, TokenApyEntry } from "@mercata/shared-types";
import { getVaultInfo } from "./vault.service";

const { Pool, DECIMALS } = constants;
const ZERO_APY = "0.00";

export const getTokenApys = async (accessToken: string): Promise<TokenApyEntry[]> => {
  const now = Date.now();
  const twentyFourHoursAgo = toUTCTime(new Date(now - 24 * 60 * 60 * 1000));
  const thirtyDaysAgoTime = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = toUTCTime(thirtyDaysAgoTime);
  const thirtyDaysAgoDate = thirtyDaysAgoTime.toISOString().split("T")[0];
  const vaultAddr = constants.vault;
  const yieldHistoryAssets = [...new Set(yieldBenchmarks.flatMap((p) => [p.tokenAddress, p.baseAddress]))];

  const mappingOr = `(and(address.eq.${constants.lendingPool},collection_name.eq.assetConfigs,key->>key.eq.${constants.USDST}),and(address.eq.${constants.USDST},collection_name.eq._balances,key->>key.eq.${constants.liquidityPool}),and(address.eq.${constants.priceOracle},collection_name.eq.prices))`;
  const eventOr = `(and(event_name.eq.Swap,block_timestamp.gte.${twentyFourHoursAgo}),and(address.eq.${constants.safetyModule},event_name.in.(Staked,Redeemed,RewardNotified,ShortfallCovered),block_timestamp.gte.${thirtyDaysAgo}))`;

  // Phase 1: 5 parallel calls
  const [
    { data: storageRows },
    { data: mappingRows },
    { data: eventRows },
    { data: pools },
    { data: yieldHistRows },
  ] = await Promise.all([
    cirrus.get(accessToken, "/storage", { params: {
      address: `in.(${constants.lendingPool},${constants.safetyModule},${constants.sToken})`,
      select: "address,data->>borrowableAsset,data->>mToken,data->>totalScaledDebt,data->>borrowIndex,data->>reservesAccrued,data->>_managedAssets,data->>_totalSupply",
    }}),
    cirrus.get(accessToken, "/mapping", { params: { select: "address,collection_name,key->>key,value::text", or: mappingOr } }),
    cirrus.get(accessToken, `/${constants.Event}`, { params: { select: "address,event_name,attributes,block_timestamp", or: eventOr } }),
    cirrus.get(accessToken, `/${Pool}`, { params: {
      poolFactory: `eq.${constants.poolFactory}`,
      select: "address,tokenA:tokenA_fkey(address,_symbol),tokenB:tokenB_fkey(address,_symbol),tokenABalance::text,tokenBBalance::text,swapFeeRate,lpSharePercent,isPaused,isDisabled",
    }}),
    yieldHistoryAssets.length
      ? cirrus.get(accessToken, "/history@mapping", { params: {
        address: `eq.${constants.priceOracle}`,
        collection_name: "eq.prices",
        "key->>key": `in.(${yieldHistoryAssets.join(",")})`,
        select: "key->>key,value::text",
        valid_from: `lte.${thirtyDaysAgoDate}`,
        valid_to: `gte.${thirtyDaysAgoDate}`,
      }})
      : Promise.resolve({ data: [] as any[] }),
  ]);

  // Parse storage
  const storageByAddr = new Map((storageRows || []).map((r: any) => [r.address, r]));
  const lpData: any = storageByAddr.get(constants.lendingPool);
  const smRow = storageByAddr.get(constants.safetyModule);
  const stRow = storageByAddr.get(constants.sToken);
  // Parse mapping
  const prices = new Map<string, string>();
  const historicalYieldPrices = new Map<string, string>();
  let lendingCfg: any = null;
  let liqBalance: string | null = null;
  for (const r of mappingRows || []) {
    if (r.collection_name === "prices") prices.set(r.key, r.value);
    else if (r.collection_name === "assetConfigs") lendingCfg = JSON.parse(r.value);
    else if (r.collection_name === "_balances") liqBalance = r.value;
  }
  for (const r of yieldHistRows || []) {
    if (r.key) historicalYieldPrices.set(r.key, r.value || "0");
  }

  // Parse events (single pass)
  const swapEvents: any[] = [], smEvents: any[] = [];
  for (const e of eventRows || []) {
    switch (e.event_name) {
      case "Swap": swapEvents.push(e); break;
      case "Staked": case "Redeemed": case "RewardNotified": case "ShortfallCovered": smEvents.push(e); break;
    }
  }

  let vaultInfo: Awaited<ReturnType<typeof getVaultInfo>> | null = null;
  if (vaultAddr) {
    vaultInfo = await getVaultInfo(accessToken);
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

  const baseYieldByAddr = new Map<string, number>();
  for (const pair of yieldBenchmarks) {
    const apy = computeYieldAPY(
      prices.get(pair.tokenAddress),
      prices.get(pair.baseAddress),
      historicalYieldPrices.get(pair.tokenAddress),
      historicalYieldPrices.get(pair.baseAddress),
    );
    if (!apy) continue;
    add(pair.tokenAddress, { source: "base", apy, meta: `${pair.tokenSymbol}/${pair.baseSymbol}` });
    baseYieldByAddr.set(pair.tokenAddress, parseFloat(apy));
  }

  const volumeMap = buildVolumeMap(swapEvents, prices);
  const activePools = (pools || []).filter((p: any) =>
    p.tokenA?.address && p.tokenB?.address &&
    !p.isPaused && !p.isDisabled &&
    !(p.tokenABalance === "0" && p.tokenBBalance === "0") &&
    !hiddenSwapPools.has(p.address)
  );
  for (const p of activePools) {
    const meta = `${p.tokenA._symbol}-${p.tokenB._symbol}`;
    const poolAddress = String(p.address ?? "").toLowerCase().replace(/^0x/, "");
    const swapApy = computePoolAPY(p, prices, volumeMap);
    if (swapApy !== ZERO_APY) {
      const row = { source: "swap" as const, apy: swapApy, meta, ...(poolAddress ? { poolAddress } : {}) };
      add(p.tokenA.address, row);
      add(p.tokenB.address, row);
    }
    if (baseYieldByAddr.size > 0) {
      const wApy = weightedBaseYield([p.tokenA.address, p.tokenB.address], [p.tokenABalance || "0", p.tokenBBalance || "0"], prices, baseYieldByAddr);
      if (wApy) {
        add(p.tokenA.address, { source: "weighted_swap", apy: wApy, meta, ...(poolAddress ? { poolAddress } : {}) });
        add(p.tokenB.address, { source: "weighted_swap", apy: wApy, meta, ...(poolAddress ? { poolAddress } : {}) });
      }
    }
  }

  const vaultAssets = (vaultInfo?.assets || [])
    .map((asset) => asset.address)
    .filter((addr) => addr && addr !== "0000000000000000000000000000000000000000");
  const vaultAlpha = vaultInfo?.alpha;
  if (vaultAlpha && vaultAlpha !== "-" && parseFloat(vaultAlpha) > 0) {
    for (const addr of vaultAssets) add(addr, { source: "vault", apy: vaultAlpha });
  }
  if (vaultInfo && baseYieldByAddr.size > 0) {
    const weightedVaultApy = weightedBaseYield(
      vaultInfo.assets.map((asset) => asset.address),
      vaultInfo.assets.map((asset) => asset.balance || "0"),
      new Map(vaultInfo.assets.map((asset) => [asset.address, asset.priceUsd || "0"])),
      baseYieldByAddr,
    );
    if (weightedVaultApy) {
      for (const addr of vaultAssets) add(addr, { source: "vault_weighted", apy: weightedVaultApy });
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
    const usd = Number(BigInt(bals[i] || "0") * BigInt(prices.get(addrs[i]) || "0") / DECIMALS) / 1e18;
    total += usd;
    ws += usd * (baseYields.get(addrs[i]) || 0);
  }
  return total > 0 && ws > 0 ? (ws / total).toFixed(2) : null;
}

function computeYieldAPY(
  tokenNowRaw?: string,
  baseNowRaw?: string,
  tokenStartRaw?: string,
  baseStartRaw?: string,
): string | null {
  try {
    const tokenNow = BigInt(tokenNowRaw || "0");
    const baseNow = BigInt(baseNowRaw || "0");
    const tokenStart = BigInt(tokenStartRaw || "0");
    const baseStart = BigInt(baseStartRaw || "0");
    if (tokenNow <= 0n || baseNow <= 0n || tokenStart <= 0n || baseStart <= 0n) return null;

    const ratioNow = Number(tokenNow) / Number(baseNow);
    const ratioStart = Number(tokenStart) / Number(baseStart);
    if (!isFinite(ratioNow) || !isFinite(ratioStart) || ratioStart <= 0) return null;

    const periodReturn = ratioNow / ratioStart - 1;
    if (periodReturn <= -1 || !isFinite(periodReturn)) return null;

    const apy = (Math.pow(1 + periodReturn, 365 / 30) - 1) * 100;
    return apy > 0 ? apy.toFixed(2) : null;
  } catch {
    return null;
  }
}
