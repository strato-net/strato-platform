import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { hiddenSwapPools } from "../../config/config";
import { toUTCTime } from "../helpers/cirrusHelpers";
import { totalDebtFromScaled, calculateAPYs } from "../helpers/lending.helper";
import { ApySource, TokenApyEntry } from "@mercata/shared-types";

const { Pool, DECIMALS } = constants;
const ZERO_APY = "0.00";

const calcEquity = (addrs: string[], bals: Map<string, string>, pxs: Map<string, string>) =>
  addrs.reduce((s, a) => s + BigInt(bals.get(a) || "0") * BigInt(pxs.get(a) || "0") / DECIMALS, 0n);

export const getTokenApys = async (accessToken: string): Promise<TokenApyEntry[]> => {
  const twentyFourHoursAgo = toUTCTime(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const thirtyDaysAgo = toUTCTime(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const vaultAddr = constants.vault;

  const mappingOr = `(and(address.eq.${constants.lendingPool},collection_name.eq.assetConfigs,key->>key.eq.${constants.USDST}),and(address.eq.${constants.USDST},collection_name.eq._balances,key->>key.eq.${constants.liquidityPool}),and(address.eq.${constants.priceOracle},collection_name.eq.prices)${vaultAddr ? `,and(address.eq.${vaultAddr},collection_name.eq.supportedAssets)` : ""})`;
  const eventOr = `(and(event_name.eq.Swap,block_timestamp.gte.${twentyFourHoursAgo}),and(address.eq.${constants.safetyModule},event_name.in.(Staked,Redeemed,RewardNotified,ShortfallCovered),block_timestamp.gte.${thirtyDaysAgo})${vaultAddr ? `,and(address.eq.${vaultAddr},event_name.in.(Deposited,Withdrawn),block_timestamp.gte.${thirtyDaysAgo})` : ""})`;

  // Phase 1: 4 parallel calls
  const [
    { data: storageRows },
    { data: mappingRows },
    { data: eventRows },
    { data: pools },
  ] = await Promise.all([
    cirrus.get(accessToken, "/storage", { params: {
      address: `in.(${constants.lendingPool},${constants.safetyModule},${constants.sToken}${vaultAddr ? `,${vaultAddr}` : ""})`,
      select: "address,data->>borrowableAsset,data->>mToken,data->>totalScaledDebt,data->>borrowIndex,data->>reservesAccrued,data->>_managedAssets,data->>_totalSupply,data->>botExecutor,data->>priceOracle",
    }}),
    cirrus.get(accessToken, "/mapping", { params: { select: "address,collection_name,key->>key,value::text", or: mappingOr } }),
    cirrus.get(accessToken, `/${constants.Event}`, { params: { select: "address,event_name,attributes,block_timestamp", or: eventOr } }),
    cirrus.get(accessToken, `/${Pool}`, { params: {
      poolFactory: `eq.${constants.poolFactory}`,
      select: "address,tokenA:tokenA_fkey(address,_symbol),tokenB:tokenB_fkey(address,_symbol),tokenABalance::text,tokenBBalance::text,swapFeeRate,lpSharePercent,isPaused,isDisabled",
    }}),
  ]);

  // Parse storage
  const storageByAddr = new Map((storageRows || []).map((r: any) => [r.address, r]));
  const lpData: any = storageByAddr.get(constants.lendingPool);
  const smRow = storageByAddr.get(constants.safetyModule);
  const stRow = storageByAddr.get(constants.sToken);
  const vaultStorage: any = vaultAddr ? storageByAddr.get(vaultAddr) : null;
  const botExecutor = vaultStorage?.botExecutor;

  // Parse mapping
  const prices = new Map<string, string>();
  let lendingCfg: any = null;
  let liqBalance: string | null = null;
  const vaultAssets: string[] = [];
  for (const r of mappingRows || []) {
    if (r.collection_name === "prices") prices.set(r.key, r.value);
    else if (r.collection_name === "assetConfigs") lendingCfg = JSON.parse(r.value);
    else if (r.collection_name === "_balances") liqBalance = r.value;
    else if (r.collection_name === "supportedAssets" && r.value) {
      const addr = r.value.replace(/"/g, "");
      if (addr) vaultAssets.push(addr);
    }
  }

  // Parse events (single pass)
  const swapEvents: any[] = [], smEvents: any[] = [], vaultDeposits: any[] = [], vaultWithdrawals: any[] = [];
  for (const e of eventRows || []) {
    switch (e.event_name) {
      case "Swap": swapEvents.push(e); break;
      case "Deposited": vaultDeposits.push(e); break;
      case "Withdrawn": vaultWithdrawals.push(e); break;
      case "Staked": case "Redeemed": case "RewardNotified": case "ShortfallCovered": smEvents.push(e); break;
    }
  }

  // Phase 2: vault APY needs bot balances + historical equity (depends on phase 1)
  let vaultAPY: string | null = null;
  const filteredVaultAssets = vaultAssets.filter(a => a !== "0000000000000000000000000000000000000000");
  const vaultOracle = vaultStorage?.priceOracle || constants.priceOracle;
  if (vaultAddr && botExecutor && filteredVaultAssets.length && vaultDeposits.length) {
    vaultAPY = await computeVaultAPY(
      accessToken, filteredVaultAssets, botExecutor, vaultOracle, prices, vaultDeposits, vaultWithdrawals
    );
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

  const volumeMap = buildVolumeMap(swapEvents, prices);
  const activePools = (pools || []).filter((p: any) =>
    p.tokenA?.address && p.tokenB?.address &&
    !p.isPaused && !p.isDisabled &&
    !(p.tokenABalance === "0" && p.tokenBBalance === "0") &&
    !hiddenSwapPools.has(p.address)
  );
  for (const p of activePools) {
    const apy = computePoolAPY(p, prices, volumeMap);
    if (apy === ZERO_APY) continue;
    const meta = `${p.tokenA._symbol}-${p.tokenB._symbol}`;
    add(p.tokenA.address, { source: "swap", apy, meta });
    add(p.tokenB.address, { source: "swap", apy, meta });
  }

  if (vaultAPY && vaultAPY !== "-" && parseFloat(vaultAPY) > 0) {
    for (const addr of filteredVaultAssets) add(addr, { source: "vault", apy: vaultAPY });
  }

  const safetyAPY = computeSafetyAPY(smRow, stRow, smEvents);
  if (safetyAPY) add(constants.USDST, { source: "safety", apy: safetyAPY });

  return [...map.entries()].map(([token, apys]) => ({ token, apys }));
};

async function computeVaultAPY(
  accessToken: string,
  assets: string[],
  botExecutor: string,
  oracleAddr: string,
  prices: Map<string, string>,
  deposits: any[],
  withdrawals: any[],
): Promise<string | null> {
  try {
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const assetList = assets.join(",");

    const [{ data: botBalances }, { data: histRows }] = await Promise.all([
      cirrus.get(accessToken, "/mapping", { params: {
        address: `in.(${assetList})`, collection_name: "eq._balances",
        "key->>key": `eq.${botExecutor}`, select: "address,value::text",
      }}),
      cirrus.get(accessToken, "/history@mapping", { params: {
        select: "address,collection_name,key->>key,value::text",
        or: `(and(address.in.(${assetList}),collection_name.eq._balances,key->>key.eq.${botExecutor}),and(address.eq.${oracleAddr},collection_name.eq.prices,key->>key.in.(${assetList})))`,
        valid_from: `lte.${startDate}`, valid_to: `gte.${startDate}`,
      }}),
    ]);

    const balMap = new Map<string, string>((botBalances || []).map((b: any) => [b.address, b.value || "0"]));
    const currentEquity = calcEquity(assets, balMap, prices);
    if (currentEquity <= 0n) return null;

    const totalDeposits = deposits.reduce((s: bigint, d: any) => s + BigInt(d.attributes?.depositValueUSD || "0"), 0n);
    const totalWithdrawals = withdrawals.reduce((s: bigint, w: any) => s + BigInt(w.attributes?.withdrawValueUSD || "0"), 0n);

    const histBalMap = new Map<string, string>();
    const histPriceMap = new Map<string, string>();
    for (const r of histRows || []) {
      if (r.collection_name === "_balances") histBalMap.set(r.address, r.value || "0");
      else if (r.collection_name === "prices") histPriceMap.set(r.key, r.value || "0");
    }
    const startEquity = calcEquity(assets, histBalMap, histPriceMap);
    if (startEquity <= 0n) return null;

    const profit = (currentEquity - startEquity) + totalWithdrawals - totalDeposits;
    const periodReturn = Number(profit * DECIMALS / startEquity) / 1e18;
    if (periodReturn <= -1 || !isFinite(periodReturn)) return null;

    return ((Math.pow(1 + periodReturn, 365 / 30) - 1) * 100).toFixed(2);
  } catch {
    return null;
  }
}

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
