import { strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { loopRouter } from "../../config/config";
import { FunctionInput } from "../../types/types";
import type {
  CDPAssetConfig,
  CDPBootstrapData,
  LoopBootstrapResponse,
  LoopRouteOpportunity,
  LoopExecuteRequest,
  LoopExecuteResponse,
  LoopPositionResponse,
} from "@mercata/shared-types";
import {
  RAY,
  WAD,
  fetchSwapPools,
  findPoolForAsset,
  findSwapPool,
  fetchCDPBootstrap,
  fetchCDPAssetConfig,
  fetchAssetSymbols,
  fetchLoopBaseYields,
  fetchPositionBootstrap,
  computeTargetNewDebt,
  quoteSwap,
  type NormalizedPool,
  type SwapPoolHandle,
  type CDPBootstrapRow,
} from "../helpers/loop.helper";

const { Token } = constants;
const LOOP_ROUTER_ADDR = loopRouter;
const DEFAULT_SLIPPAGE_BPS = 100; // 1%
const DEADLINE_BUFFER_SECS = 600; // 10 minutes
const DEFAULT_STABILITY_APR = 2;   // % APR fallback
const DEFAULT_MIN_CR = 155;        // % fallback
const DEFAULT_LIQUIDATION_RATIO = 150; // % fallback

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

const round = (n: number, dp = 3) => {
  const k = 10 ** dp;
  return Math.round(n * k) / k;
};

function netCarryAPR(M: number, baseYield: number, borrowRate: number): number {
  return round(M * baseYield - (M - 1) * borrowRate);
}

function buildCDPAssetList(assets: CDPBootstrapRow[], priceMap: Map<string, string>): CDPAssetConfig[] {
  return assets.map((a) => ({
    address: a.asset,
    decimals: 18,
    price: priceMap.get(a.asset.toLowerCase()) || "0",
    minCR: a.minCR,
    liquidationRatio: a.liquidationRatio,
    stabilityFeeRate: a.stabilityFeeRate || DEFAULT_STABILITY_APR,
    debtFloor: a.debtFloor,
    debtCeiling: a.debtCeiling,
  }));
}

function buildOpportunities(
  cdpAssets: Array<{ asset: string; symbol: string }>,
  pools: NormalizedPool[],
  usdstAddress: string,
  baseYieldMap: Record<string, number>,
): LoopRouteOpportunity[] {
  const usdstLower = usdstAddress.toLowerCase();
  const opportunities: LoopRouteOpportunity[] = [];
  for (const asset of cdpAssets) {
    const assetLower = asset.asset.toLowerCase();
    const yieldAPR = baseYieldMap[assetLower] || 0;
    if (yieldAPR <= 0) continue; // only surface yield-earning assets
    const match = findPoolForAsset(pools, assetLower, usdstLower);
    if (!match) continue;
    if (BigInt(match.usdstLiquidity || "0") === 0n) continue; // pool must be swappable
    opportunities.push({
      asset: asset.asset,
      symbol: asset.symbol,
      baseYieldAPR: yieldAPR,
      swapPoolUSDSTLiquidity: match.usdstLiquidity,
      swapFeeBps: match.swapFeeBps,
    });
  }
  return opportunities;
}

// ═══════════════════════════════════════════════════════════════
// Bootstrap — 2 rounds:
//   Round 1: cdp + pools in parallel (neither needs the other)
//   Round 2: symbols + yields in parallel (both need the asset list)
// ═══════════════════════════════════════════════════════════════

export async function getBootstrap(accessToken: string): Promise<LoopBootstrapResponse> {
  const [cdp, pools] = await Promise.all([
    fetchCDPBootstrap(accessToken),
    fetchSwapPools(accessToken, constants.USDST),
  ]);
  const assetAddrs = cdp.assets.map((a) => a.asset);

  const [symbolMap, baseYieldMap] = await Promise.all([
    fetchAssetSymbols(accessToken, assetAddrs),
    fetchLoopBaseYields(accessToken, assetAddrs),
  ]);

  const firstAsset = cdp.assets[0];
  const cdpData: CDPBootstrapData = {
    stabilityAPR: firstAsset?.stabilityFeeRate || DEFAULT_STABILITY_APR,
    minCR: firstAsset?.minCR || DEFAULT_MIN_CR,
    liquidationRatio: firstAsset?.liquidationRatio || DEFAULT_LIQUIDATION_RATIO,
    assets: buildCDPAssetList(cdp.assets, cdp.priceMap),
  };

  const assetsWithSymbols = cdp.assets.map((a) => ({
    asset: a.asset,
    symbol: symbolMap.get(a.asset.toLowerCase()) || "UNKNOWN",
  }));

  return {
    routes: { cdp: cdpData },
    opportunities: buildOpportunities(assetsWithSymbols, pools, constants.USDST, baseYieldMap),
  };
}

// ═══════════════════════════════════════════════════════════════
// Execute — uses constants.USDST directly, no registry fetch
// ═══════════════════════════════════════════════════════════════

function buildLeverageTxs(
  req: LoopExecuteRequest,
  swapPool: SwapPoolHandle,
  targetNewDebt: string,
  minFinalCollateral: string,
  maxSlippageBps: number,
  deadline: number,
): FunctionInput[] {
  return [
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
        targetNewDebt,
        minFinalCollateral,
        poolAddress: swapPool.poolAddress,
        poolType: swapPool.poolType,
        coinI: swapPool.coinI,
        coinJ: swapPool.coinJ,
        maxSlippageBps,
        deadline,
      },
    },
  ];
}

export async function executeLoop(
  accessToken: string,
  userAddress: string,
  req: LoopExecuteRequest,
): Promise<LoopExecuteResponse> {
  const [swapPool, cdpAsset] = await Promise.all([
    findSwapPool(accessToken, constants.USDST, req.asset),
    fetchCDPAssetConfig(accessToken, req.asset),
  ]);
  if (!swapPool) throw new Error(`No swap pool for USDST <-> ${req.asset}`);

  const price = cdpAsset.price;
  const unitScale = BigInt(cdpAsset.config?.unitScale || WAD.toString());
  if (price === 0n) throw new Error(`No oracle price for ${req.asset}`);

  const targetNewDebt = computeTargetNewDebt({
    amount: BigInt(req.amount),
    targetLevWAD: BigInt(Math.round(req.targetLeverage * 1e18)),
    priceWAD: price,
    unitScale,
    pool: swapPool,
  });
  if (targetNewDebt <= 0n) throw new Error("D* solver did not converge — target leverage may be unsupported");

  const maxSlippageBps = req.maxSlippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const expectedSwapOut = quoteSwap(swapPool, targetNewDebt);
  const minFinalCollateral = BigInt(req.amount) + (expectedSwapOut * (10000n - BigInt(maxSlippageBps))) / 10000n;

  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECS;
  const txs = buildLeverageTxs(req, swapPool, targetNewDebt.toString(), minFinalCollateral.toString(), maxSlippageBps, deadline);
  const built = await buildFunctionTx(txs, userAddress, accessToken);
  const result = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, built),
  );
  return { txHash: result.hash };
}

// ═══════════════════════════════════════════════════════════════
// Position — one /mapping call (bootstrap + vaults + rateAccs) plus
// one side call for cached base yields.
// ═══════════════════════════════════════════════════════════════

export async function getPosition(accessToken: string, userAddress: string): Promise<LoopPositionResponse> {
  const ctx = await fetchPositionBootstrap(accessToken, userAddress);
  const activeAssets: string[] = [];
  for (const [assetLower, v] of ctx.vaults) {
    if (v.collateral > 0n || v.scaledDebt > 0n) activeAssets.push(assetLower);
  }
  if (activeAssets.length === 0) return { cdp: [] };

  const baseYieldMap = await fetchLoopBaseYields(accessToken, activeAssets);

  const configMap = new Map(ctx.assets.map((a) => [a.asset.toLowerCase(), a]));
  const priceMap = ctx.priceMap;

  const positions = activeAssets.map((assetLower) => {
    const v = ctx.vaults.get(assetLower)!;
    const cfg = configMap.get(assetLower);
    const price = BigInt(priceMap.get(assetLower) || "0");
    const unitScale = BigInt(cfg?.unitScale || WAD.toString());

    const collateral = v.collateral;
    const collateralValueUSD = unitScale > 0n ? (collateral * price) / unitScale : 0n;
    // Apply live rateAccumulator so accrued stability fees are reflected; fall back to RAY (no accrual) if missing.
    const rateAcc = ctx.rateAccumulators.get(assetLower) ?? RAY;
    const currentDebt = (v.scaledDebt * rateAcc) / RAY;

    const cUSD = Number(collateralValueUSD) / 1e18;
    const d = Number(currentDebt) / 1e18;
    const q = cUSD > 0 ? d / cUSD : 0;
    const lev = q < 1 ? 1 / (1 - q) : 1;

    const liquidationRatio = cfg?.liquidationRatio || DEFAULT_LIQUIDATION_RATIO;
    let cr = 0;
    if (currentDebt > 0n) {
      cr = Number((collateralValueUSD * WAD) / currentDebt) / Number(WAD) * 100;
    } else if (collateral > 0n) {
      cr = Number.MAX_SAFE_INTEGER;
    }
    const healthFactor = liquidationRatio > 0 ? round(cr / liquidationRatio, 2) : 0;

    const y = baseYieldMap[assetLower] || 0;
    const borrowRate = Number(cfg?.stabilityFeeRate) || DEFAULT_STABILITY_APR;

    return {
      asset: assetLower,
      collateral: collateral.toString(),
      collateralUSD: collateralValueUSD.toString(),
      debt: currentDebt.toString(),
      healthFactor,
      effectiveLTV: round(q, 4),
      leverage: round(lev),
      estimatedCarryAPR: netCarryAPR(lev, y, borrowRate),
      collateralizationRatio: round(cr, 2),
    };
  });

  return { cdp: positions };
}
