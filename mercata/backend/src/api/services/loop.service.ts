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
  SWAP_FEE_BPS,
  WAD,
  fetchSwapPools,
  findPoolForAsset,
  findSwapPool,
  fetchCDPBootstrap,
  fetchAssetSymbols,
  fetchUserVaults,
  fetchLoopBaseYields,
  computeTargetNewDebt,
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
    const match = findPoolForAsset(pools, assetLower, usdstLower);
    if (!match) continue;
    opportunities.push({
      asset: asset.asset,
      symbol: asset.symbol,
      baseYieldAPR: baseYieldMap[assetLower] || 0,
      swapPoolUSDSTLiquidity: match.usdstLiquidity,
      swapFeeBps: match.swapFeeBps,
    });
  }
  return opportunities;
}

// ═══════════════════════════════════════════════════════════════
// Bootstrap — 2-phase fan-out
//   Phase 1: single CDPRegistry kitchen-sink join (1 GET)
//   Phase 2: pools + symbols + yields in parallel (~3 GETs)
// ═══════════════════════════════════════════════════════════════

export async function getBootstrap(accessToken: string): Promise<LoopBootstrapResponse> {
  const cdp = await fetchCDPBootstrap(accessToken);
  const assetAddrs = cdp.assets.map((a) => a.asset);

  const [pools, symbolMap, baseYieldMap] = await Promise.all([
    fetchSwapPools(accessToken, constants.USDST),
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
    swapFeeBps: SWAP_FEE_BPS,
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
  const [swapPool, cdp] = await Promise.all([
    findSwapPool(accessToken, constants.USDST, req.asset),
    fetchCDPBootstrap(accessToken),
  ]);
  if (!swapPool) throw new Error(`No swap pool for USDST <-> ${req.asset}`);

  const assetLower = req.asset.toLowerCase();
  const price = BigInt(cdp.priceMap.get(assetLower) || "0");
  const cfg = cdp.assets.find((a) => a.asset.toLowerCase() === assetLower);
  const unitScale = BigInt(cfg?.unitScale || WAD.toString());
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
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECS;
  const txs = buildLeverageTxs(req, swapPool, targetNewDebt.toString(), maxSlippageBps, deadline);
  const built = await buildFunctionTx(txs, userAddress, accessToken);
  const result = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, built),
  );
  return { txHash: result.hash };
}

// ═══════════════════════════════════════════════════════════════
// Position — 2-phase fan-out
//   Phase 1: CDPEngine-vaults for user (1 GET)
//   Phase 2: symbols + yields in parallel (~2 GETs, yields cached)
// ═══════════════════════════════════════════════════════════════

export async function getPosition(accessToken: string, userAddress: string): Promise<LoopPositionResponse> {
  const rawVaults = await fetchUserVaults(accessToken, userAddress);
  const withBalance = rawVaults.filter(
    (v) => BigInt(v.collateral || "0") > 0n || BigInt(v.scaledDebt || "0") > 0n,
  );

  if (withBalance.length === 0) return { cdp: [] };

  const assetAddrs = withBalance.map((v) => v.asset);
  const [cdp, symbolMap, baseYieldMap] = await Promise.all([
    fetchCDPBootstrap(accessToken),
    fetchAssetSymbols(accessToken, assetAddrs),
    fetchLoopBaseYields(accessToken, assetAddrs),
  ]);

  // Build lookup maps from the CDP bootstrap data.
  const configMap = new Map(cdp.assets.map((a) => [a.asset.toLowerCase(), a]));
  const priceMap = cdp.priceMap;

  const positions = withBalance.map((v) => {
    const assetLower = v.asset.toLowerCase();
    const cfg = configMap.get(assetLower);
    const price = BigInt(priceMap.get(assetLower) || "0");
    const unitScale = BigInt(cfg?.unitScale || WAD.toString());

    const collateral = BigInt(v.collateral || "0");
    const collateralValueUSD = unitScale > 0n ? (collateral * price) / unitScale : 0n;
    const currentDebt = BigInt(v.scaledDebt || "0");

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
      asset: v.asset,
      symbol: symbolMap.get(assetLower) || "UNKNOWN",
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
