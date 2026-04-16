import { createHash } from "crypto";
import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import * as config from "../../config/config";
import { FunctionInput } from "../../types/types";
import { getSupportedAssets, getCDPRegistry, getVaults as cdpGetVaults } from "./cdp.service";
import {
  CarryMetrics,
  CDPAssetConfig,
  CDPBootstrapData,
  LoopBootstrapResponse,
  LoopRouteOpportunity,
  LoopExecuteRequest,
  LoopExecuteResponse,
  LoopPositionResponse,
} from "./loop.types";
import { getTokenApys } from "./earn.service";

const { Token } = constants;
const LOOP_ROUTER_ADDR = config.loopRouter;
const SWAP_FEE_BPS = 30;
const DEFAULT_SLIPPAGE_BPS = 100; // 1%
const DEADLINE_BUFFER_SECS = 600; // 10 minutes

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function computeSwapImpact(dxUSDST: number, poolReserveUSDST: number, swapFeeBps: number): number {
  if (poolReserveUSDST <= 0 || dxUSDST <= 0) return 0;
  const g = 1 - swapFeeBps / 10000;
  return (g * dxUSDST) / (poolReserveUSDST + g * dxUSDST);
}

function computeCarry(
  baseYield: number,
  borrowRate: number,
  swapFeeBps: number,
  effectiveLTV: number,
  poolReserveUSDST: number,
  initialAmountUSD: number,
): CarryMetrics {
  const M = 1 / (1 - effectiveLTV);
  const grossCarryAPR = M * baseYield - (M - 1) * borrowRate;
  const feeDrag = 2 * (M - 1) * (swapFeeBps / 10000) * 100;
  const netCarryAPR = grossCarryAPR - feeDrag;
  const refUSD = initialAmountUSD > 0 ? initialAmountUSD : 1000;
  const avgLegUSDST = (M - 1) * refUSD / Math.max(Math.ceil(M - 1), 1);
  const impactPerLeg = computeSwapImpact(avgLegUSDST, poolReserveUSDST, swapFeeBps);
  const totalImpactDrag = 2 * (M - 1) * impactPerLeg * 100;
  const netCarryWithImpactAPR = netCarryAPR - totalImpactDrag;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    exposureMultiple: r(M), effectiveLTV,
    grossCarryAPR: r(grossCarryAPR), feeDrag: r(feeDrag),
    netCarryAPR: r(netCarryAPR), swapImpactPct: r(impactPerLeg * 100),
    netCarryWithImpactAPR: r(netCarryWithImpactAPR), healthFactor: 0,
  };
}

async function fetchBaseYields(accessToken: string): Promise<Record<string, number>> {
  const yields: Record<string, number> = {};
  try {
    const apyData = await getTokenApys(accessToken);
    for (const item of apyData) {
      const addr = (item.token || "").toLowerCase();
      const yieldEntry = (item.apys || []).find((a: any) => a.source === "base" || a.source === "yield");
      if (yieldEntry) yields[addr] = parseFloat(yieldEntry.apy) || 0;
    }
  } catch {}
  return yields;
}

async function findSwapPool(
  accessToken: string, tokenA: string, tokenB: string,
): Promise<{ poolAddress: string; isAToB: boolean } | null> {
  const { data: pools } = await cirrus.get(accessToken, `/${constants.Pool}`, {
    params: {
      poolFactory: `eq.${constants.poolFactory}`,
      locked: "eq.false",
      swapFeeRate: "eq.0", // constant-product pools only
      select: "address,tokenA,tokenB",
      or: `(and(tokenA.eq.${tokenA},tokenB.eq.${tokenB}),and(tokenA.eq.${tokenB},tokenB.eq.${tokenA}))`,
    },
  });
  if (!pools || pools.length === 0) return null;
  const pool = pools[0];
  return { poolAddress: pool.address, isAToB: pool.tokenA.toLowerCase() === tokenA.toLowerCase() };
}

function buildCDPAssetList(cdpAssets: any[], priceMap: Map<string, string>): CDPAssetConfig[] {
  return cdpAssets.map((a: any) => ({
    address: a.asset, symbol: a.symbol, decimals: 18,
    price: priceMap.get(a.asset) || "0",
    minCR: a.minCR, liquidationRatio: a.liquidationRatio, stabilityFeeRate: a.stabilityFeeRate,
    debtFloor: a.debtFloor, debtCeiling: a.debtCeiling, unitScale: a.unitScale, isPaused: a.isPaused,
  }));
}

async function fetchSwapPools(accessToken: string) {
  const { data } = await cirrus.get(accessToken, `/${constants.Pool}`, {
    params: {
      poolFactory: `eq.${constants.poolFactory}`,
      locked: "eq.false",
      swapFeeRate: "eq.0", // constant-product pools only (StablePool stores fee on pool)
      select: "address,tokenA,tokenB,tokenABalance::text,tokenBBalance::text",
    },
  });
  return data || [];
}

function buildOpportunities(
  cdpAssets: CDPAssetConfig[], pools: any[], usdstAddress: string,
  baseYieldMap: Record<string, number>, stabilityAPR: number, minCR: number, liquidationRatio: number,
): LoopRouteOpportunity[] {
  const opportunities: LoopRouteOpportunity[] = [];
  for (const asset of cdpAssets) {
    const pool = pools.find((p: any) => {
      const tA = (p.tokenA || "").toLowerCase();
      const tB = (p.tokenB || "").toLowerCase();
      return (tA === asset.address.toLowerCase() && tB === usdstAddress.toLowerCase()) ||
             (tA === usdstAddress.toLowerCase() && tB === asset.address.toLowerCase());
    });
    if (!pool) continue;
    const tA = (pool.tokenA || "").toLowerCase();
    const usdstLiq = tA === usdstAddress.toLowerCase() ? (pool.tokenABalance || "0") : (pool.tokenBBalance || "0");
    const reserveUSD = Number(BigInt(usdstLiq)) / 1e18;
    const g = 1 - SWAP_FEE_BPS / 10000;
    const maxSwapPerLeg = (0.01 * reserveUSD) / (g * 0.99);
    const baseYield = baseYieldMap[asset.address.toLowerCase()] || 0;
    const assetMinCR = asset.minCR || minCR;
    const maxLTV = assetMinCR > 100 ? 100 / assetMinCR : 0.50;
    const safeQ = maxLTV * 0.95;
    const carry = computeCarry(baseYield, stabilityAPR, SWAP_FEE_BPS, safeQ, reserveUSD, 1000);
    const assetLiqRatio = (asset.liquidationRatio || liquidationRatio) / 100;
    const healthFactor = assetLiqRatio > 0 && safeQ > 0 ? Math.round(((1 / safeQ) / assetLiqRatio) * 100) / 100 : 0;
    opportunities.push({
      asset: asset.address, symbol: asset.symbol, baseYieldAPR: baseYield,
      swapPoolAddress: pool.address, swapPoolUSDSTLiquidity: usdstLiq,
      swapFeeRate: SWAP_FEE_BPS / 10000,
      maxSwapPerLeg: (Math.round(maxSwapPerLeg * 100) / 100).toString(),
      cdpCarry: { ...carry, healthFactor },
    });
  }
  opportunities.sort((a, b) => (b.cdpCarry?.netCarryAPR ?? -999) - (a.cdpCarry?.netCarryAPR ?? -999));
  return opportunities;
}

// ═══════════════════════════════════════════════════════════════
// Bootstrap
// ═══════════════════════════════════════════════════════════════

export async function getBootstrap(accessToken: string): Promise<LoopBootstrapResponse> {
  const [cdpAssets, cdpRegistry, baseYieldMap] = await Promise.all([
    getSupportedAssets(accessToken),
    getCDPRegistry(accessToken, undefined, {
      select: `address,usdst,priceOracle:priceOracle_fkey(address,prices:${constants.PriceOracle}-prices(asset:key,value::text))`,
    }, "bootstrap"),
    fetchBaseYields(accessToken),
  ]);
  const cdpPriceMap = new Map<string, string>();
  (cdpRegistry.priceOracle?.prices || []).forEach((p: any) => cdpPriceMap.set(p.asset, p.value));
  const cdpAssetList = buildCDPAssetList(cdpAssets, cdpPriceMap);
  const firstAsset = cdpAssets[0] as any;
  const cdpData: CDPBootstrapData = {
    usdstAddress: cdpRegistry.usdst || "",
    stabilityAPR: firstAsset?.stabilityFeeRate || 2,
    minCR: firstAsset?.minCR || 155,
    liquidationRatio: firstAsset?.liquidationRatio || 150,
    assets: cdpAssetList,
  };
  const pools = await fetchSwapPools(accessToken);
  const opportunities = buildOpportunities(
    cdpAssetList, pools, cdpData.usdstAddress, baseYieldMap,
    cdpData.stabilityAPR, cdpData.minCR, cdpData.liquidationRatio,
  );
  const bootstrap: LoopBootstrapResponse = {
    version: "",
    timestamp: new Date().toISOString(),
    networkId: config.networkId || "",
    gasFeePerStep: constants.GAS_FEE_WEI.toString(),
    swapFeeBps: SWAP_FEE_BPS,
    routes: { cdp: cdpData },
    opportunities,
  };
  bootstrap.version = createHash("sha256").update(JSON.stringify({ routes: bootstrap.routes, gasFeePerStep: bootstrap.gasFeePerStep })).digest("hex").slice(0, 16);
  return bootstrap;
}

// ═══════════════════════════════════════════════════════════════
// Execute
// ═══════════════════════════════════════════════════════════════

export async function executeLoop(
  accessToken: string,
  userAddress: string,
  req: LoopExecuteRequest,
): Promise<LoopExecuteResponse> {
  const targetLeverageWAD = BigInt(Math.round((req.targetLeverage || 2.0) * 1e18)).toString();
  const maxSlippageBps = req.maxSlippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECS;

  const registry = await getCDPRegistry(accessToken, userAddress, {}, "loop-execute");
  if (!registry.usdst) throw new Error("CDP addresses not found");

  const swapPool = await findSwapPool(accessToken, registry.usdst, req.asset);
  if (!swapPool) throw new Error(`No swap pool for USDST <-> ${req.asset}`);

  const txs: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: req.asset,
      method: "approve",
      args: { spender: LOOP_ROUTER_ADDR, value: req.amount },
    },
    {
      contractName: "LoopRouter",
      contractAddress: LOOP_ROUTER_ADDR,
      method: "leverageUp",
      args: {
        asset: req.asset,
        amount: req.amount,
        targetLeverageWAD,
        poolAddress: swapPool.poolAddress,
        swapIsAToB: swapPool.isAToB,
        maxSlippageBps,
        deadline,
      },
    },
  ];

  const built = await buildFunctionTx(txs, userAddress, accessToken);
  const result = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, built),
  );

  return { txHash: result.hash };
}

// ═══════════════════════════════════════════════════════════════
// Position
// ═══════════════════════════════════════════════════════════════

export async function getPosition(accessToken: string, userAddress: string): Promise<LoopPositionResponse> {
  const [cdpVaults, bs] = await Promise.all([
    cdpGetVaults(accessToken, userAddress),
    getBootstrap(accessToken),
  ]);
  const yMap = new Map(bs.opportunities.map((o) => [o.asset.toLowerCase(), o]));

  const cdp = cdpVaults
    .filter((v: any) => BigInt(v.collateralAmount || "0") > 0n || BigInt(v.debtAmount || "0") > 0n)
    .map((v: any) => {
      const cUSD = Number(BigInt(v.collateralValueUSD || "0")) / 1e18;
      const d = Number(BigInt(v.debtAmount || "0")) / 1e18;
      const q = cUSD > 0 ? d / cUSD : 0;
      const lev = q < 1 ? 1 / (1 - q) : 1;
      const y = yMap.get(v.asset?.toLowerCase())?.baseYieldAPR || 0;
      const carry = lev * y - (lev - 1) * (v.stabilityFeeRate || bs.routes.cdp.stabilityAPR) - 2 * (lev - 1) * (bs.swapFeeBps / 10000) * 100;
      return {
        asset: v.asset, symbol: v.symbol || "UNKNOWN",
        collateral: v.collateralAmount || "0", collateralUSD: v.collateralValueUSD || "0",
        debt: v.debtAmount || "0", healthFactor: v.healthFactor || 0,
        effectiveLTV: Math.round(q * 10000) / 10000, leverage: Math.round(lev * 1000) / 1000,
        estimatedCarryAPR: Math.round(carry * 1000) / 1000, collateralizationRatio: v.collateralizationRatio || 0,
      };
    });

  return { cdp };
}
