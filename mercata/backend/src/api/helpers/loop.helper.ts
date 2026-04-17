// Helpers for the loop feature. Self-contained Cirrus queries — the loop
// service should not depend on cdp.service, earn.service, or getTokenApys.
//
// Entry points:
//   Pool:   fetchSwapPools, findPoolForAsset, findSwapPool
//   CDP:    fetchCDPBootstrap, fetchUserVaults, fetchAssetSymbols
//   Yield:  fetchLoopBaseYields
//   Solver: computeTargetNewDebt (off-chain D* for flash-mint leverage)

import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { yieldBenchmarks, priceOracle } from "../../config/config";
import { fetchMultiTokenStablePools } from "./swapping.helper";
import { RAY } from "./lending.helper";
// Re-export for loop.service.ts consumers.
export { RAY };
import {
  getYieldExchangeRateRowsCached,
  getYieldWindowBounds,
  mergeBackfillRows,
  indexYieldHistoryRows,
  computeExchangeRateAPY,
} from "./earnYield.helper";
export const WAD = constants.DECIMALS; // 10n ** 18n
export const SWAP_FEE_BPS = 30;

// Backend-internal types — not exposed via API, not shared with UI.
type PoolType = 0 | 1;

interface CPPoolState {
  rin: bigint;
  rout: bigint;
  feeBps: number;
}

interface StablePoolState {
  balances: bigint[];
  rates: bigint[];
  amp: bigint;
  fee: bigint;
  offpegFeeMultiplier: bigint;
  numCoins: number;
}

export interface SwapPoolHandle {
  poolAddress: string;
  poolType: PoolType;
  coinI: number;
  coinJ: number;
  cpState?: CPPoolState;
  stableState?: StablePoolState;
}

export type NormalizedPool =
  | {
      kind: "pair";
      address: string;
      tokenA: string;
      tokenB: string;
      tokenABalance: string;
      tokenBBalance: string;
      poolType: PoolType;
      swapFeeBps: number;
    }
  | {
      kind: "multi";
      address: string;
      coins: { index: number; address: string }[];
      usdstBalance: string;
      poolType: 1;
      swapFeeBps: number;
    };

// Curve StablePool constants — match the contract's `FEE_DENOMINATOR` and `A_PRECISION`.
// `PRECISION` in the contract is 1e18 which is the same as our WAD, so we reuse WAD.
const FEE_DENOMINATOR = 10n ** 10n;
const A_PRECISION = 100n;
const SOLVER_TOLERANCE = 10n ** 12n;

// ═══════════════════════════════════════════════════════════════
// Off-chain pool quoting — mirrors on-chain Pool.quoteSwap / StablePool.quoteSwap
// ═══════════════════════════════════════════════════════════════

function computeQuoteCP(amountIn: bigint, rin: bigint, rout: bigint, feeBps: number): bigint {
  const fee = amountIn * BigInt(feeBps) / 10000n;
  const netInput = amountIn - fee;
  return (netInput * rout) / (rin + netInput);
}

function computeCurrentA(
  initialA: bigint, futureA: bigint, initialATime: bigint, futureATime: bigint, now: bigint,
): bigint {
  if (now < futureATime) {
    if (futureA > initialA) {
      return initialA + ((futureA - initialA) * (now - initialATime)) / (futureATime - initialATime);
    }
    return initialA - ((initialA - futureA) * (now - initialATime)) / (futureATime - initialATime);
  }
  return futureA;
}

function stableGetD(xp: bigint[], amp: bigint): bigint {
  const n = BigInt(xp.length);
  let s = 0n;
  for (const x of xp) { if (x === 0n) return 0n; s += x; }

  let d = s;
  const ann = amp * n;
  const nPow = n ** n;

  for (let i = 0; i < 256; i++) {
    let dP = d;
    for (const x of xp) dP = (dP * d) / x;
    dP /= nPow;
    const dPrev = d;
    d = ((ann * s / A_PRECISION + dP * n) * d) /
        (((ann - A_PRECISION) * d / A_PRECISION) + (n + 1n) * dP);
    const diff = d > dPrev ? d - dPrev : dPrev - d;
    if (diff <= 1n) return d;
  }
  throw new Error("getD did not converge");
}

function stableGetY(i: number, j: number, x: bigint, xp: bigint[], amp: bigint, d: bigint): bigint {
  const n = BigInt(xp.length);
  let s = 0n;
  let c = d;
  const ann = amp * n;

  for (let k = 0; k < xp.length; k++) {
    const xk = k === i ? x : k === j ? 0n : xp[k];
    if (xk === 0n && k !== j) continue;
    if (k !== j) {
      s += xk;
      c = (c * d) / (xk * n);
    }
  }
  c = (c * d * A_PRECISION) / (ann * n);
  const b = s + (d * A_PRECISION) / ann;
  let y = d;

  for (let iter = 0; iter < 256; iter++) {
    const yPrev = y;
    y = (y * y + c) / (2n * y + b - d);
    const diff = y > yPrev ? y - yPrev : yPrev - y;
    if (diff <= 1n) return y;
  }
  throw new Error("getY did not converge");
}

function stableDynamicFee(xpi: bigint, xpj: bigint, fee: bigint, offpegMul: bigint): bigint {
  if (offpegMul <= FEE_DENOMINATOR) return fee;
  const xps2 = (xpi + xpj) * (xpi + xpj);
  return (offpegMul * fee) /
    ((((offpegMul - FEE_DENOMINATOR) * 4n * xpi * xpj) / xps2) + FEE_DENOMINATOR);
}

function computeQuoteStable(dx: bigint, i: number, j: number, st: StablePoolState): bigint {
  const xp: bigint[] = [];
  for (let k = 0; k < st.numCoins; k++) xp.push(st.rates[k] * st.balances[k] / WAD);

  const amp = st.amp;
  const d = stableGetD(xp, amp);
  const x = xp[i] + dx * st.rates[i] / WAD;
  const y = stableGetY(i, j, x, xp, amp, d);
  const rawDy = xp[j] - y - 1n;
  const dyFee = rawDy * stableDynamicFee((xp[i] + x) / 2n, (xp[j] + y) / 2n, st.fee, st.offpegFeeMultiplier) / FEE_DENOMINATOR;
  return (rawDy - dyFee) * WAD / st.rates[j];
}

// ═══════════════════════════════════════════════════════════════
// Pool-polymorphic quote — used by the D* solver and for computing
// minFinalCollateral in the execute path.
// ═══════════════════════════════════════════════════════════════

export function quoteSwap(pool: SwapPoolHandle, dx: bigint): bigint {
  if (pool.poolType === 0 && pool.cpState) {
    return computeQuoteCP(dx, pool.cpState.rin, pool.cpState.rout, pool.cpState.feeBps);
  }
  if (pool.poolType === 1 && pool.stableState) {
    return computeQuoteStable(dx, pool.coinI, pool.coinJ, pool.stableState);
  }
  throw new Error("pool state missing for quote");
}

// ═══════════════════════════════════════════════════════════════
// D* solver — mirrors LoopRouter.test.sol _computeFlashDebt*
// Fixed-point iteration: D = (amount + X(D)) * price/unitScale * (L-1)/L
// ═══════════════════════════════════════════════════════════════

interface DebtSolverParams {
  amount: bigint;
  targetLevWAD: bigint;
  priceWAD: bigint;
  unitScale: bigint;
  pool: SwapPoolHandle;
}

export function computeTargetNewDebt(p: DebtSolverParams): bigint {
  const { amount, targetLevWAD, priceWAD, unitScale, pool } = p;
  const levMinus1 = targetLevWAD - WAD;

  let D = amount * priceWAD / unitScale * levMinus1 / WAD;
  if (D === 0n) D = 1n;

  for (let i = 0; i < 20; i++) {
    const X = quoteSwap(pool, D);
    const targetDebt = (amount + X) * priceWAD / unitScale * levMinus1 / targetLevWAD;
    const diff = targetDebt > D ? targetDebt - D : D - targetDebt;
    D = targetDebt;
    if (diff < SOLVER_TOLERANCE) break;
  }
  return D;
}

const SECONDS_PER_YEAR = 31536000n;

// Fixed-point exponentiation matching the contract's _rpow.
// Duplicated here because cdp.service doesn't export it and we
// intentionally avoid cross-service imports.
function rpow(x: bigint, n: bigint, base: bigint): bigint {
  let z = n % 2n !== 0n ? x : base;
  let xCopy = x;
  for (let nCopy = n / 2n; nCopy !== 0n; nCopy /= 2n) {
    xCopy = (xCopy * xCopy) / base;
    if (nCopy % 2n !== 0n) z = (z * xCopy) / base;
  }
  return z;
}

function stabilityFeeRateToAPR(rateRay: string | bigint): number {
  const annual = rpow(BigInt(rateRay), SECONDS_PER_YEAR, RAY);
  const delta = annual - RAY;
  const intPart = delta / RAY;
  const fracPart = (delta % RAY) * WAD / RAY;
  return (Number(intPart) + Number(fracPart) / 1e18) * 100;
}

// ═══════════════════════════════════════════════════════════════
// CDP: bootstrap context (1 Cirrus GET replaces 3)
// ═══════════════════════════════════════════════════════════════

export interface CDPBootstrapRow {
  asset: string;
  minCR: number;
  liquidationRatio: number;
  stabilityFeeRate: number;
  debtFloor: string;
  debtCeiling: string;
  unitScale: string;
}

interface CDPBootstrapResult {
  priceMap: Map<string, string>;
  assets: CDPBootstrapRow[];
}

export async function fetchCDPBootstrap(accessToken: string): Promise<CDPBootstrapResult> {
  const { CDPEngine, PriceOracle: POTable, CDPRegistry } = constants;
  const cdpRegistryAddr = constants.cdpRegistry || "0000000000000000000000000000000000001012";

  // Phase 1: read the registry row to get priceOracle + cdpEngine addresses.
  // priceOracle_fkey has been seen to drop out of the cirrus schema cache after
  // CDPEngine upgrades, so fetch the address plainly and issue a separate query
  // for prices.
  const { data: [reg] } = await cirrus.get(accessToken, `/${CDPRegistry}`, {
    params: { address: `eq.${cdpRegistryAddr}`, select: "address,priceOracle,cdpEngine" },
  });
  const priceOracleAddr = reg?.priceOracle || "";
  const engineAddr = reg?.cdpEngine || "";

  // Phase 2: fan out 3 independent fetches.
  const [pricesRes, configsRes, supportedRes] = await Promise.all([
    priceOracleAddr
      ? cirrus.get(accessToken, `/${POTable}-prices`, {
          params: { address: `eq.${priceOracleAddr}`, select: "asset:key,value::text" },
        })
      : Promise.resolve({ data: [] }),
    engineAddr
      ? cirrus.get(accessToken, `/${CDPEngine}-collateralConfigs`, {
          params: { address: `eq.${engineAddr}`, select: "asset:key,CollateralConfig:value" },
        })
      : Promise.resolve({ data: [] }),
    engineAddr
      ? cirrus.get(accessToken, `/${CDPEngine}-isSupportedAsset`, {
          params: { address: `eq.${engineAddr}`, value: "eq.true", select: "asset:key,value" },
        })
      : Promise.resolve({ data: [] }),
  ]);

  const priceMap = new Map<string, string>();
  for (const p of pricesRes.data || []) priceMap.set((p.asset as string).toLowerCase(), p.value);

  const supportedSet = new Set(
    (supportedRes.data || []).map((s: any) => s.asset?.toLowerCase()),
  );
  const assets: CDPBootstrapRow[] = [];
  for (const c of configsRes.data || []) {
    if (!supportedSet.has(c.asset?.toLowerCase())) continue;
    const cfg = c.CollateralConfig;
    if (!cfg) continue;
    assets.push({
      asset: c.asset,
      minCR: Number(cfg.minCR) / Number(WAD) * 100,
      liquidationRatio: Number(cfg.liquidationRatio) / Number(WAD) * 100,
      stabilityFeeRate: stabilityFeeRateToAPR(cfg.stabilityFeeRate),
      debtFloor: cfg.debtFloor || "0",
      debtCeiling: cfg.debtCeiling || "0",
      unitScale: cfg.unitScale || WAD.toString(),
    });
  }
  return { priceMap, assets };
}

// ═══════════════════════════════════════════════════════════════
// CDP: batched symbol lookup (1 GET replaces N)
// ═══════════════════════════════════════════════════════════════

export async function fetchAssetSymbols(
  accessToken: string,
  addresses: string[],
): Promise<Map<string, string>> {
  if (addresses.length === 0) return new Map();
  const { data } = await cirrus.get(accessToken, `/${constants.Token}`, {
    params: { address: `in.(${addresses.join(",")})`, status: "eq.2", select: "address,_symbol" },
  });
  return new Map((data || []).map((r: any) => [r.address.toLowerCase(), r._symbol]));
}

// ═══════════════════════════════════════════════════════════════
// CDP: user vaults (1 GET replaces 2× registry + engine + N×token)
// ═══════════════════════════════════════════════════════════════

interface RawVaultRow {
  asset: string;
  collateral: string;
  scaledDebt: string;
}

export async function fetchUserVaults(
  accessToken: string,
  userAddress: string,
): Promise<RawVaultRow[]> {
  const cdpEngineAddr = "0000000000000000000000000000000000001011";
  const { data } = await cirrus.get(accessToken, `/${constants.CDPEngine}-vaults`, {
    params: {
      select: "asset:key2,Vault:value",
      key: `eq.${userAddress.toLowerCase()}`,
      address: `eq.${cdpEngineAddr}`,
    },
  });
  return (data || []).map((r: any) => ({
    asset: r.asset,
    collateral: r.Vault?.collateral || "0",
    scaledDebt: r.Vault?.scaledDebt || "0",
  }));
}

// Per-asset rateAccumulator (RAY-scaled). scaledDebt * rateAccumulator / RAY = currentDebt
// in USDST wei. Needed to display the accrued stability-fee-inclusive debt.
export async function fetchRateAccumulators(
  accessToken: string,
  assetAddresses: string[],
): Promise<Map<string, bigint>> {
  if (assetAddresses.length === 0) return new Map();
  const cdpEngineAddr = "0000000000000000000000000000000000001011";
  // PostgREST `in.(...)` on JSON-typed address columns rejects bare hex literals,
  // so fetch all rows for this engine and filter client-side.
  const { data } = await cirrus.get(accessToken, `/${constants.CDPEngine}-collateralGlobalStates`, {
    params: {
      address: `eq.${cdpEngineAddr}`,
      select: "asset:key,value",
    },
  });
  const wanted = new Set(assetAddresses.map((a) => a.toLowerCase()));
  const map = new Map<string, bigint>();
  for (const row of (data || []) as any[]) {
    const asset = (row.asset as string).toLowerCase();
    if (!wanted.has(asset)) continue;
    const v = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    const ra = BigInt(v?.rateAccumulator || "0");
    map.set(asset, ra > 0n ? ra : RAY);
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════
// Yield: base yields via exchange rate history (1 GET, cached)
// ═══════════════════════════════════════════════════════════════

export async function fetchLoopBaseYields(
  accessToken: string,
  assetAddresses: string[],
): Promise<Record<string, number>> {
  const wanted = new Set(assetAddresses.map((a) => a.toLowerCase()));
  const benchmarks = yieldBenchmarks.filter((b) => wanted.has(b.tokenAddress.toLowerCase()));
  if (benchmarks.length === 0) return {};

  const { windowStart, windowEndExclusive, anchorsMs } = getYieldWindowBounds(Date.now());
  const rows = await getYieldExchangeRateRowsCached(accessToken, {
    priceOracle,
    exchangeRateAddrs: benchmarks.map((b) => b.tokenAddress),
    windowStart,
    windowEndExclusive,
    anchorsMs,
  });
  const history = indexYieldHistoryRows(mergeBackfillRows(rows));
  const yields: Record<string, number> = {};
  for (const b of benchmarks) {
    const apy = computeExchangeRateAPY(b.tokenAddress, history, anchorsMs);
    if (apy) yields[b.tokenAddress.toLowerCase()] = parseFloat(apy);
  }
  return yields;
}

const poolFeeBps = (raw: any): number => Number(raw) || SWAP_FEE_BPS;

// ═══════════════════════════════════════════════════════════════
// Bootstrap: enumerate all candidate pools
// ═══════════════════════════════════════════════════════════════

export async function fetchSwapPools(
  accessToken: string,
  usdstAddress: string,
): Promise<NormalizedPool[]> {
  // Pool table surfaces CP pools + 2-coin StablePools (both expose tokenA/tokenB
  // and tokenABalance/tokenBBalance). CP pools store swapFeeRate=0 and inherit
  // the factory default (30 bps). StablePools store their own rate.
  const { data: poolRows } = await cirrus.get(accessToken, `/${constants.Pool}`, {
    params: {
      poolFactory: `eq.${constants.poolFactory}`,
      locked: "eq.false",
      select: "address,tokenA,tokenB,tokenABalance::text,tokenBBalance::text,isStable,swapFeeRate",
    },
  });
  const pools: NormalizedPool[] = (poolRows || []).map((p: any): NormalizedPool => ({
    kind: "pair",
    address: p.address,
    tokenA: p.tokenA,
    tokenB: p.tokenB,
    tokenABalance: p.tokenABalance,
    tokenBBalance: p.tokenBBalance,
    poolType: p.isStable ? 1 : 0,
    swapFeeBps: poolFeeBps(p.swapFeeRate),
  }));

  // Multi-coin StablePools (>2 coins) aren't represented in the Pool view;
  // the shared helper filters `initialA > 0` so uninitialized pools are skipped.
  const seen = new Set(pools.map((p) => p.address.toLowerCase()));
  const multiTokenPools = await fetchMultiTokenStablePools(accessToken);
  const usdstLower = usdstAddress.toLowerCase();
  for (const mp of multiTokenPools) {
    if (seen.has(mp.address.toLowerCase())) continue;
    const usdstCoin = mp.coins.find((c) => c.tokenAddress.toLowerCase() === usdstLower);
    if (!usdstCoin) continue;
    // tokenBalances is keyed by whatever casing cirrus stores — use the coin's raw tokenAddress.
    pools.push({
      kind: "multi",
      address: mp.address,
      poolType: 1,
      usdstBalance: mp.tokenBalances.get(usdstCoin.tokenAddress) || "0",
      coins: mp.coins.map((c) => ({ index: c.coinIndex, address: c.tokenAddress.toLowerCase() })),
      swapFeeBps: poolFeeBps((mp as any).swapFeeRate),
    });
  }
  return pools;
}

// Finds the USDST-paired pool for an asset and returns its USDST liquidity + fee.
// Returns null if no such pool exists.
export function findPoolForAsset(
  pools: NormalizedPool[],
  assetLower: string,
  usdstLower: string,
): { usdstLiquidity: string; swapFeeBps: number } | null {
  for (const pool of pools) {
    switch (pool.kind) {
      case "multi": {
        const hasPair =
          pool.coins.some((c) => c.address === assetLower) &&
          pool.coins.some((c) => c.address === usdstLower);
        if (hasPair) return { usdstLiquidity: pool.usdstBalance || "0", swapFeeBps: pool.swapFeeBps };
        break;
      }
      case "pair": {
        const tA = (pool.tokenA || "").toLowerCase();
        const tB = (pool.tokenB || "").toLowerCase();
        if ((tA === assetLower && tB === usdstLower) || (tA === usdstLower && tB === assetLower)) {
          const usdstLiquidity = tA === usdstLower ? (pool.tokenABalance || "0") : (pool.tokenBBalance || "0");
          return { usdstLiquidity, swapFeeBps: pool.swapFeeBps };
        }
        break;
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Execute: resolve a single pool + coin indices
// ═══════════════════════════════════════════════════════════════

// CP or 2-coin StablePool via the Pool table. Returns the pool address + type + reserves.
async function findPairPool(
  accessToken: string, usdst: string, asset: string,
): Promise<{
  poolAddress: string; poolType: PoolType; isAToB: boolean;
  tokenABalance: string; tokenBBalance: string; swapFeeRate: number;
} | null> {
  const { data: pools } = await cirrus.get(accessToken, `/${constants.Pool}`, {
    params: {
      poolFactory: `eq.${constants.poolFactory}`,
      locked: "eq.false",
      select: "address,tokenA,tokenB,isStable,swapFeeRate,tokenABalance::text,tokenBBalance::text",
      or: `(and(tokenA.eq.${usdst},tokenB.eq.${asset}),and(tokenA.eq.${asset},tokenB.eq.${usdst}))`,
    },
  });
  if (!pools || pools.length === 0) return null;
  const pool = pools[0];
  return {
    poolAddress: pool.address,
    poolType: pool.isStable ? 1 : 0,
    isAToB: pool.tokenA.toLowerCase() === usdst.toLowerCase(),
    tokenABalance: pool.tokenABalance || "0",
    tokenBBalance: pool.tokenBBalance || "0",
    swapFeeRate: Number(pool.swapFeeRate) || SWAP_FEE_BPS,
  };
}

// Resolves coin indices + full stable-pool state for the off-chain solver.
async function resolveStablePoolState(
  accessToken: string, poolAddress: string, usdst: string, collateral: string,
): Promise<{ coinI: number; coinJ: number; stableState: StablePoolState | null }> {
  const [{ data: coins }, { data: [spRow] }] = await Promise.all([
    cirrus.get(accessToken, `/${constants.StablePoolCoins}`, {
      params: { address: `eq.${poolAddress}`, select: "key,value", order: "key.asc" },
    }),
    cirrus.get(accessToken, "/BlockApps-StablePool", {
      params: {
        address: `eq.${poolAddress}`,
        select: [
          "fee::text,offpegFeeMultiplier::text,initialA::text,futureA::text,initialATime::text,futureATime::text",
          `,BlockApps-StablePool-tokenBalances(key,value::text)`,
          `,BlockApps-StablePool-rateMultipliers(key,value::text)`,
          `,BlockApps-StablePool-assetTypes(key,value::text)`,
        ].join(""),
      },
    }),
  ]);

  const usdstLower = usdst.toLowerCase();
  const collLower = collateral.toLowerCase();
  let coinI = -1, coinJ = -1;
  const coinAddrs: string[] = [];
  for (const c of (coins || []) as any[]) {
    const idx = Number(c.key);
    const addr = (c.value || "").toLowerCase();
    coinAddrs[idx] = addr;
    if (addr === usdstLower) coinI = idx;
    else if (addr === collLower) coinJ = idx;
  }

  if (!spRow) return { coinI, coinJ, stableState: null };

  const numCoins = coinAddrs.length;
  const balMap = new Map<string, string>();
  for (const b of spRow["BlockApps-StablePool-tokenBalances"] || []) balMap.set((b.key as string).toLowerCase(), b.value);
  const rateMap = new Map<string, string>();
  for (const r of spRow["BlockApps-StablePool-rateMultipliers"] || []) rateMap.set(r.key.toLowerCase(), r.value);
  const atMap = new Map<string, string>();
  for (const a of spRow["BlockApps-StablePool-assetTypes"] || []) atMap.set(a.key.toLowerCase(), a.value);

  const balances: bigint[] = [];
  const rates: bigint[] = [];
  for (let i = 0; i < numCoins; i++) {
    const addr = coinAddrs[i];
    balances.push(BigInt(balMap.get(addr) || "0"));
    const assetType = Number(atMap.get(addr) || "0");
    if (assetType === 3) throw new Error("stable pool rate-oracle assets (assetType=3) not supported in off-chain solver");
    rates.push(BigInt(rateMap.get(addr) || WAD.toString()));
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const amp = computeCurrentA(
    BigInt(spRow.initialA || "0"),
    BigInt(spRow.futureA || "0"),
    BigInt(spRow.initialATime || "0"),
    BigInt(spRow.futureATime || "0"),
    now,
  );

  return {
    coinI,
    coinJ,
    stableState: {
      balances,
      rates,
      amp,
      fee: BigInt(spRow.fee || "0"),
      offpegFeeMultiplier: BigInt(spRow.offpegFeeMultiplier || "0"),
      numCoins,
    },
  };
}

// Multi-coin StablePools via the coins table — finds pool then fetches full state.
async function findMultiCoinStablePool(
  accessToken: string, usdst: string, asset: string,
): Promise<SwapPoolHandle | null> {
  const usdstLower = usdst.toLowerCase();
  const assetLower = asset.toLowerCase();
  const { data: rows } = await cirrus.get(accessToken, `/${constants.StablePoolCoins}`, {
    params: { value: `in.(${usdstLower},${assetLower})`, select: "address,key,value" },
  });
  const byPool = new Map<string, { coinI: number; coinJ: number }>();
  for (const row of (rows || []) as any[]) {
    const slot = byPool.get(row.address) || { coinI: -1, coinJ: -1 };
    const coinAddr = (row.value || "").toLowerCase();
    if (coinAddr === usdstLower) slot.coinI = Number(row.key);
    else if (coinAddr === assetLower) slot.coinJ = Number(row.key);
    byPool.set(row.address, slot);
  }
  for (const [poolAddress, { coinI, coinJ }] of byPool) {
    if (coinI < 0 || coinJ < 0) continue;
    const resolved = await resolveStablePoolState(accessToken, poolAddress, usdst, asset);
    return {
      poolAddress, poolType: 1, coinI, coinJ,
      stableState: resolved.stableState ?? undefined,
    };
  }
  return null;
}

// Public entry point. Tries the Pool table first (covers CP + 2-coin stable),
// then falls back to the multi-coin stable coins table.
// Returns a handle enriched with pool state for the off-chain D* solver.
export async function findSwapPool(
  accessToken: string, usdst: string, asset: string,
): Promise<SwapPoolHandle | null> {
  const pair = await findPairPool(accessToken, usdst, asset);
  if (pair) {
    if (pair.poolType === 0) {
      const isAToB = pair.isAToB;
      return {
        poolAddress: pair.poolAddress,
        poolType: 0,
        coinI: isAToB ? 0 : 1,
        coinJ: isAToB ? 1 : 0,
        cpState: {
          rin: BigInt(isAToB ? pair.tokenABalance : pair.tokenBBalance),
          rout: BigInt(isAToB ? pair.tokenBBalance : pair.tokenABalance),
          feeBps: pair.swapFeeRate,
        },
      };
    }
    const resolved = await resolveStablePoolState(accessToken, pair.poolAddress, usdst, asset);
    if (resolved.coinI >= 0 && resolved.coinJ >= 0) {
      return {
        poolAddress: pair.poolAddress, poolType: 1,
        coinI: resolved.coinI, coinJ: resolved.coinJ,
        stableState: resolved.stableState ?? undefined,
      };
    }
  }
  return findMultiCoinStablePool(accessToken, usdst, asset);
}
