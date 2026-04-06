import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import * as config from "../../config/config";
import { FunctionInput } from "../../types/types";
import {
  getPool,
  getExchangeRateFromCirrus,
  getPublicCollateralInfo,
} from "./lending.service";
import { getSupportedAssets, getCDPRegistry } from "./cdp.service";
import { swap as executeSwap } from "./swapping.service";
import {
  LoopBootstrapResponse,
  LoopRouteOpportunity,
  LoopExecuteRequest,
  LoopExecuteResponse,
  LoopStepResult,
  LoopHistoryEntry,
  LoopPositionResponse,
  LoopPositionEntry,
  LoopUnwindRequest,
  LOOP_CONSTANTS,
} from "./loop.types";
import {
  collateralAndBalance as lendingCollateralAndBalance,
  liquidityAndBalance as lendingLiquidityAndBalance,
  withdrawCollateral as lendingWithdrawCollateral,
  repay as lendingRepay,
  repayAll as lendingRepayAll,
  withdrawCollateralMax as lendingWithdrawCollateralMax,
} from "./lending.service";
import {
  getVaults as cdpGetVaults,
  withdraw as cdpWithdraw,
  withdrawMax as cdpWithdrawMax,
  repay as cdpRepay,
  repayAll as cdpRepayAll,
  getMaxWithdraw as cdpGetMaxWithdraw,
} from "./cdp.service";

const {
  Token,
  LendingPool,
  CollateralVault,
  PriceOracle,
  CDPEngine,
} = constants;

const WAD = BigInt(10) ** BigInt(18);
const SWAP_SLIPPAGE_BPS = 500n; // 5% slippage tolerance for POC

const idempotencyStore = new Map<string, LoopExecuteResponse>();

async function findSwapPool(
  accessToken: string,
  tokenA: string,
  tokenB: string
): Promise<{ poolAddress: string; isAToB: boolean } | null> {
  const { data: pools } = await cirrus.get(accessToken, `/${constants.Pool}`, {
    params: {
      poolFactory: `eq.${constants.poolFactory}`,
      isDisabled: "eq.false",
      select: "address,tokenA,tokenB",
      or: `(and(tokenA.eq.${tokenA},tokenB.eq.${tokenB}),and(tokenA.eq.${tokenB},tokenB.eq.${tokenA}))`,
    },
  });

  if (!pools || pools.length === 0) return null;
  const pool = pools[0];
  const isAToB = pool.tokenA.toLowerCase() === tokenA.toLowerCase();
  return { poolAddress: pool.address, isAToB };
}

const historyStore: Map<string, LoopHistoryEntry[]> = new Map();

function computeBootstrapHash(data: LoopBootstrapResponse): string {
  const raw = JSON.stringify({
    routes: data.routes,
    gasFeePerStep: data.gasFeePerStep,
    maxLoops: data.maxLoops,
  });
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

import { getTokenApys } from "./earn.service";

async function fetchBaseYields(accessToken: string): Promise<Record<string, number>> {
  const yields: Record<string, number> = {};
  try {
    const apyData = await getTokenApys(accessToken);
    for (const item of apyData) {
      const addr = (item.token || "").toLowerCase();
      const yieldEntry = (item.apys || []).find((a: any) => a.source === "yield");
      if (yieldEntry) {
        yields[addr] = parseFloat(yieldEntry.apy) || 0;
      }
    }
  } catch {
    // Fall back to empty — zero-yield assets just get 0
  }
  return yields;
}

// impact ≈ g * dx / (x + g * dx), where g = 1 - fee, dx = swap amount, x = pool USDST reserve
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
  assetPriceUSD: number,
  initialAmountUSD: number,
): { exposureMultiple: number; grossCarryAPR: number; feeDrag: number; netCarryAPR: number; swapImpactPct: number; netCarryWithImpactAPR: number } {
  const M = 1 / (1 - effectiveLTV);
  const grossCarryAPR = M * baseYield - (M - 1) * borrowRate;
  const feeDrag = 2 * (M - 1) * (swapFeeBps / 10000) * 100;
  const netCarryAPR = grossCarryAPR - feeDrag;

  // Estimate average swap leg size: total debt / number_of_legs ≈ (M-1)*initialAmountUSD / M
  // For a "reference" $1000 position if no initialAmountUSD given
  const refUSD = initialAmountUSD > 0 ? initialAmountUSD : 1000;
  const avgLegUSDST = (M - 1) * refUSD / Math.max(Math.ceil(M - 1), 1);
  const impactPerLeg = computeSwapImpact(avgLegUSDST, poolReserveUSDST, swapFeeBps);
  // Impact compounds: each leg loses impactPerLeg of collateral value, enter + unwind = 2 roundtrips
  const totalImpactDrag = 2 * (M - 1) * impactPerLeg * 100;
  const netCarryWithImpactAPR = netCarryAPR - totalImpactDrag;

  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    exposureMultiple: r(M),
    grossCarryAPR: r(grossCarryAPR),
    feeDrag: r(feeDrag),
    netCarryAPR: r(netCarryAPR),
    swapImpactPct: r(impactPerLeg * 100),
    netCarryWithImpactAPR: r(netCarryWithImpactAPR),
  };
}

export async function getBootstrap(
  accessToken: string
): Promise<LoopBootstrapResponse> {
  const [collateralInfo, cdpAssets, registry, exchangeRate, baseYieldMap] = await Promise.all([
    getPublicCollateralInfo(accessToken),
    getSupportedAssets(accessToken),
    getPool(accessToken, {
      select: `lendingPool:lendingPool_fkey(borrowableAsset,mToken,borrowIndex::text,totalScaledDebt::text,reservesAccrued::text,lastAccrual::text,assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value)),oracle:priceOracle_fkey(prices:${PriceOracle}-prices(asset:key,price:value::text)),liquidityPool:liquidityPool_fkey(address)`,
    }),
    getExchangeRateFromCirrus(accessToken),
    fetchBaseYields(accessToken),
  ]);

  const borrowableAsset = registry.lendingPool?.borrowableAsset || "";
  const borrowableAssetConfig = (registry.lendingPool?.assetConfigs || []).find(
    (c: any) => c.asset === borrowableAsset
  )?.AssetConfig;
  const interestRateBps = borrowableAssetConfig?.interestRate || 0;
  const borrowAPR = interestRateBps / 100;
  const ltvBps = 7500;
  const liquidationThresholdBps = 8000;

  const lendingTokens = await cirrus.get(accessToken, `/${Token}`, {
    params: {
      address: `in.(${(collateralInfo || []).map((a: any) => a.address).join(",")})`,
      select: "address,_symbol,customDecimals",
    },
  });
  const tokenMap = new Map(
    (lendingTokens.data || []).map((t: any) => [t.address, t])
  );

  const cdpRegistry = await getCDPRegistry(accessToken, undefined, {}, "bootstrap");
  const cdpPriceMap = new Map<string, string>();
  (cdpRegistry.priceOracle?.prices || []).forEach((p: any) => {
    cdpPriceMap.set(p.asset, p.value);
  });

  const lendingAssets = (collateralInfo || []).map((a: any) => {
    const tok = tokenMap.get(a.address) as any;
    return {
      address: a.address,
      symbol: tok?._symbol || "UNKNOWN",
      decimals: tok?.customDecimals || 18,
      price: a.assetPrice || "0",
      ltv: a.ltv || 0,
      liquidationThreshold: a.liquidationThreshold || 0,
      isPaused: a.isPaused || false,
    };
  });

  const lendingBorrowableToken = await cirrus.get(accessToken, `/${Token}`, {
    params: { address: `eq.${borrowableAsset}`, select: "_symbol" },
  });
  const borrowableSymbol = lendingBorrowableToken.data?.[0]?._symbol || "USDST";

  const liquidityPoolAddr = registry.liquidityPool?.address || "";
  let availableLiquidity = "0";
  if (liquidityPoolAddr && borrowableAsset) {
    const balResp = await cirrus.get(accessToken, `/${Token}-_balances`, {
      params: { address: `eq.${borrowableAsset}`, key: `eq.${liquidityPoolAddr}`, select: "value::text" },
    });
    availableLiquidity = balResp.data?.[0]?.value || "0";
  }

  // CDP params from first supported asset (they share the same stabilityFeeRate on testnet)
  const firstCdpAsset = cdpAssets[0] as any;
  const stabilityAPR = firstCdpAsset?.stabilityFeeRate || 2;
  const cdpMinCR = firstCdpAsset?.minCR || 155;
  const cdpLiquidationRatio = firstCdpAsset?.liquidationRatio || 150;

  const cdpAssetList = cdpAssets.map((a: any) => ({
    address: a.asset, symbol: a.symbol, decimals: 18,
    price: cdpPriceMap.get(a.asset) || "0",
    minCR: a.minCR, liquidationRatio: a.liquidationRatio, stabilityFeeRate: a.stabilityFeeRate,
    debtFloor: a.debtFloor, debtCeiling: a.debtCeiling, unitScale: a.unitScale, isPaused: a.isPaused,
  }));

  // Fetch swap pool data for opportunity analysis (include balances via Cirrus)
  const { data: rawPools } = await cirrus.get(accessToken, `/${constants.Pool}`, {
    params: {
      poolFactory: `eq.${constants.poolFactory}`,
      isDisabled: "eq.false",
      select: "address,tokenA,tokenB,tokenABalance::text,tokenBBalance::text,isDisabled",
    },
  });
  const allPools = rawPools || [];
  const SWAP_FEE_BPS = 30;

  // Build opportunity list for every collateral asset that has a USDST pool
  const opportunities: LoopRouteOpportunity[] = [];
  const allCollateralAddrs = new Set([
    ...lendingAssets.map((a: any) => a.address),
    ...cdpAssetList.map((a: any) => a.address),
  ]);

  for (const assetAddr of allCollateralAddrs) {
    const pool = allPools.find((p: any) => {
      if (p.isDisabled) return false;
      const tA = (p.tokenA || "").toLowerCase();
      const tB = (p.tokenB || "").toLowerCase();
      const a = assetAddr.toLowerCase();
      const u = borrowableAsset.toLowerCase();
      return (tA === a && tB === u) || (tA === u && tB === a);
    });
    if (!pool) continue;

    const sym = lendingAssets.find((a: any) => a.address === assetAddr)?.symbol
      || cdpAssetList.find((a: any) => a.address === assetAddr)?.symbol
      || "UNKNOWN";

    const baseYield = baseYieldMap[assetAddr.toLowerCase()] || 0;

    // USDST liquidity in pool
    const tA = (pool.tokenA || "").toLowerCase();
    const usdstLiq = tA === borrowableAsset.toLowerCase()
      ? (pool.tokenABalance || "0")
      : (pool.tokenBBalance || "0");

    // 1% impact max swap per leg: dx_max = s * x / (g * (1 - s)), s=0.01, g=1-fee
    const x = Number(BigInt(usdstLiq)) / 1e18;
    const g = 1 - SWAP_FEE_BPS / 10000;
    const maxSwapPerLeg = (0.01 * x) / (g * 0.99);

    const isLendingAsset = lendingAssets.some((a: any) => a.address === assetAddr);
    const isCdpAsset = cdpAssetList.some((a: any) => a.address === assetAddr);

    const poolReserve = x; // USDST pool reserve in human units (already computed above)
    const refPositionUSD = 1000; // reference $1000 starting position for impact estimate

    // Lending carry at balanced risk: q=0.55
    let lendingCarry = null;
    if (isLendingAsset) {
      const q = 0.55;
      const c = computeCarry(baseYield, borrowAPR, SWAP_FEE_BPS, q, poolReserve, 0, refPositionUSD);
      lendingCarry = { ...c, effectiveLTV: q, healthFactor: Math.round((liquidationThresholdBps / 10000) / q * 100) / 100 };
    }

    // CDP carry at balanced risk: q=0.50
    let cdpCarry = null;
    if (isCdpAsset) {
      const q = 0.50;
      const c = computeCarry(baseYield, stabilityAPR, SWAP_FEE_BPS, q, poolReserve, 0, refPositionUSD);
      cdpCarry = { ...c, effectiveLTV: q, healthFactor: Math.round((cdpMinCR / 100) / (cdpLiquidationRatio / 100) * (1 / q) * 100) / 100 };
    }

    opportunities.push({
      asset: assetAddr,
      symbol: sym,
      baseYieldAPR: baseYield,
      swapPoolAddress: pool.address,
      swapPoolUSDSTLiquidity: usdstLiq,
      swapFeeRate: SWAP_FEE_BPS / 10000,
      maxSwapPerLeg: Math.round(maxSwapPerLeg * 100) / 100 + "",
      lendingCarry,
      cdpCarry,
    });
  }

  // Sort by best net carry descending
  opportunities.sort((a, b) => {
    const aNet = Math.max(a.lendingCarry?.netCarryAPR || -999, a.cdpCarry?.netCarryAPR || -999);
    const bNet = Math.max(b.lendingCarry?.netCarryAPR || -999, b.cdpCarry?.netCarryAPR || -999);
    return bNet - aNet;
  });

  const bootstrap: LoopBootstrapResponse = {
    version: "",
    timestamp: new Date().toISOString(),
    networkId: config.networkId || "",
    gasFeePerStep: constants.GAS_FEE_WEI.toString(),
    maxLoops: LOOP_CONSTANTS.MAX_LOOPS,
    swapFeeBps: SWAP_FEE_BPS,
    routes: {
      lending: {
        borrowableAsset, borrowableSymbol, borrowAPR, ltvBps, liquidationThresholdBps,
        assets: lendingAssets, exchangeRate, availableLiquidity,
      },
      cdp: {
        usdstAddress: cdpRegistry.usdst || "", stabilityAPR, minCR: cdpMinCR, liquidationRatio: cdpLiquidationRatio,
        assets: cdpAssetList,
      },
    },
    opportunities,
  };

  bootstrap.version = computeBootstrapHash(bootstrap);
  return bootstrap;
}

async function executeLendingLoop(
  accessToken: string,
  userAddress: string,
  req: LoopExecuteRequest
): Promise<LoopStepResult[]> {
  const results: LoopStepResult[] = [];

  const registry = await getPool(accessToken, {
    select: `lendingPool:lendingPool_fkey(address,borrowableAsset,borrowIndex::text,assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value)),collateralVault:collateralVault_fkey(address),oracle:priceOracle_fkey(prices:${PriceOracle}-prices(asset:key,price:value::text)),liquidityPool:liquidityPool_fkey(address)`,
  });

  const lendingPoolAddr = registry.lendingPool?.address;
  const collateralVaultAddr = registry.collateralVault?.address;
  const borrowableAsset = registry.lendingPool?.borrowableAsset;
  if (!lendingPoolAddr || !collateralVaultAddr || !borrowableAsset) {
    throw new Error("Lending pool addresses not found");
  }

  const assetConfig = (registry.lendingPool?.assetConfigs || []).find(
    (c: any) => c.asset === req.asset
  )?.AssetConfig;
  if (!assetConfig) {
    throw new Error(`Asset ${req.asset} not configured in lending pool`);
  }

  const ltv = assetConfig.ltv || 0;
  if (ltv <= 0) {
    throw new Error(`Asset ${req.asset} has zero LTV`);
  }

  const swapPool = await findSwapPool(accessToken, borrowableAsset, req.asset);
  if (!swapPool) {
    throw new Error(`No swap pool found for ${borrowableAsset} <-> ${req.asset}`);
  }

  let collateralAmount = BigInt(req.amount);

  for (let i = 0; i < req.loops; i++) {
    const stepNum = i + 1;

    try {
      // Step A: Supply collateral
      const supplyTx: FunctionInput[] = [
        {
          contractName: extractContractName(Token),
          contractAddress: req.asset,
          method: "approve",
          args: { spender: collateralVaultAddr, value: collateralAmount.toString() },
        },
        {
          contractName: extractContractName(LendingPool),
          contractAddress: lendingPoolAddr,
          method: "supplyCollateral",
          args: { asset: req.asset, amount: collateralAmount.toString() },
        },
      ];

      const builtSupply = await buildFunctionTx(supplyTx, userAddress, accessToken);
      const supplyResult = await postAndWaitForTx(accessToken, () =>
        strato.post(accessToken, StratoPaths.transactionParallel, builtSupply)
      );

      results.push({
        step: stepNum,
        action: "supply_collateral",
        status: "success",
        txHash: supplyResult.hash,
      });

      // Step B: Borrow USDST against collateral
      const borrowAmount = (collateralAmount * BigInt(ltv)) / 10000n;
      if (borrowAmount <= 0n) {
        results.push({ step: stepNum, action: "borrow", status: "skipped", error: "Borrow amount too small after LTV" });
        break;
      }

      const borrowTx: FunctionInput = {
        contractName: extractContractName(LendingPool),
        contractAddress: lendingPoolAddr,
        method: "borrow",
        args: { amount: borrowAmount.toString() },
      };
      const builtBorrow = await buildFunctionTx(borrowTx, userAddress, accessToken);
      const borrowResult = await postAndWaitForTx(accessToken, () =>
        strato.post(accessToken, StratoPaths.transactionParallel, builtBorrow)
      );

      results.push({
        step: stepNum,
        action: "borrow",
        status: "success",
        txHash: borrowResult.hash,
      });

      // Step C: Swap borrowed USDST back to collateral asset
      // minAmountOut=1 to avoid zero-check reverts; real slippage protection comes from health factor constraints
      const deadline = Math.floor(Date.now() / 1000) + 300;

      const swapResult = await executeSwap(
        accessToken,
        {
          poolAddress: swapPool.poolAddress,
          isAToB: swapPool.isAToB,
          amountIn: borrowAmount.toString(),
          minAmountOut: "1",
          deadline,
        },
        userAddress
      );

      results.push({
        step: stepNum,
        action: "swap_to_collateral",
        status: "success",
        txHash: swapResult.hash,
      });

      // For next iteration: estimate output from price ratio (conservative)
      const nextCollateral = (borrowAmount * WAD) / BigInt((registry.oracle?.prices || []).find((p: any) => p.asset === req.asset)?.price || "1");
      collateralAmount = nextCollateral > 0n ? nextCollateral : 0n;

    } catch (err: any) {
      results.push({
        step: stepNum,
        action: "loop_step",
        status: "failed",
        error: err.message,
      });
      break;
    }
  }

  return results;
}

async function executeCDPLoop(
  accessToken: string,
  userAddress: string,
  req: LoopExecuteRequest
): Promise<LoopStepResult[]> {
  const results: LoopStepResult[] = [];

  const registry = await getCDPRegistry(accessToken, userAddress, {}, "loop-execute");
  const cdpEngineAddr = registry.cdpEngine?.address;
  const cdpVaultAddr = registry.cdpVault?.address;
  const usdstAddress = registry.usdst;
  if (!cdpEngineAddr || !cdpVaultAddr || !usdstAddress) {
    throw new Error("CDP addresses not found");
  }

  const assetConfig = (registry.cdpEngine?.collateralConfigs || []).find(
    (c: any) => c.asset.toLowerCase() === req.asset.toLowerCase()
  )?.CollateralConfig;
  if (!assetConfig) {
    throw new Error(`Asset ${req.asset} not configured in CDP`);
  }

  const priceEntry = (registry.priceOracle?.prices || []).find(
    (p: any) => p.asset.toLowerCase() === req.asset.toLowerCase()
  );
  const price = BigInt(priceEntry?.value || "0");
  if (price <= 0n) {
    throw new Error(`No oracle price for asset ${req.asset}`);
  }

  const minCR = BigInt(assetConfig.minCR || assetConfig.liquidationRatio);
  const unitScale = BigInt(assetConfig.unitScale || WAD.toString());

  const swapPool = await findSwapPool(accessToken, usdstAddress, req.asset);
  if (!swapPool) {
    throw new Error(`No swap pool found for ${usdstAddress} <-> ${req.asset}`);
  }

  let collateralAmount = BigInt(req.amount);

  for (let i = 0; i < req.loops; i++) {
    const stepNum = i + 1;

    try {
      // Step A: Deposit collateral into CDP vault
      const depositTx: FunctionInput[] = [
        {
          contractName: extractContractName(Token),
          contractAddress: req.asset,
          method: "approve",
          args: { spender: cdpVaultAddr, value: collateralAmount.toString() },
        },
        {
          contractName: extractContractName(CDPEngine),
          contractAddress: cdpEngineAddr,
          method: "deposit",
          args: { asset: req.asset, amount: collateralAmount.toString() },
        },
      ];

      const builtDeposit = await buildFunctionTx(depositTx, userAddress, accessToken);
      const depositResult = await postAndWaitForTx(accessToken, () =>
        strato.post(accessToken, StratoPaths.transactionParallel, builtDeposit)
      );

      results.push({
        step: stepNum,
        action: "deposit_collateral",
        status: "success",
        txHash: depositResult.hash,
      });

      // Step B: Mint USDST against deposited collateral (95% of max to stay safe)
      const collateralValueUSD = (collateralAmount * price) / unitScale;
      const mintableUSD = (collateralValueUSD * WAD) / minCR;
      const safeMint = (mintableUSD * 95n) / 100n;
      if (safeMint <= 0n) {
        results.push({ step: stepNum, action: "mint_usdst", status: "skipped", error: "Mintable amount too small" });
        break;
      }

      const mintTx: FunctionInput = {
        contractName: extractContractName(CDPEngine),
        contractAddress: cdpEngineAddr,
        method: "mint",
        args: { asset: req.asset, amountUSD: safeMint.toString() },
      };
      const builtMint = await buildFunctionTx(mintTx, userAddress, accessToken);
      const mintResult = await postAndWaitForTx(accessToken, () =>
        strato.post(accessToken, StratoPaths.transactionParallel, builtMint)
      );

      results.push({
        step: stepNum,
        action: "mint_usdst",
        status: "success",
        txHash: mintResult.hash,
      });

      // Step C: Swap minted USDST back to collateral asset
      const deadline = Math.floor(Date.now() / 1000) + 300;

      const swapResult = await executeSwap(
        accessToken,
        {
          poolAddress: swapPool.poolAddress,
          isAToB: swapPool.isAToB,
          amountIn: safeMint.toString(),
          minAmountOut: "1",
          deadline,
        },
        userAddress
      );

      results.push({
        step: stepNum,
        action: "swap_to_collateral",
        status: "success",
        txHash: swapResult.hash,
      });

      // Estimate collateral received from price ratio for next iteration
      const nextCollateral = (safeMint * unitScale) / price;
      collateralAmount = nextCollateral > 0n ? nextCollateral : 0n;

    } catch (err: any) {
      results.push({
        step: stepNum,
        action: "loop_step",
        status: "failed",
        error: err.message,
      });
      break;
    }
  }

  return results;
}

async function readTerminalState(accessToken: string, userAddress: string, routeType: string, asset: string) {
  try {
    if (routeType === "lending_loop") {
      const [colls, liq] = await Promise.all([
        lendingCollateralAndBalance(accessToken, userAddress),
        lendingLiquidityAndBalance(accessToken, userAddress),
      ]);
      const m = (colls || []).find((c: any) => c.address?.toLowerCase() === asset.toLowerCase());
      const collUSD = Number(BigInt(m?.collateralizedAmountValue || "0")) / 1e18;
      const debt = Number(BigInt(liq?.totalAmountOwed || "0")) / 1e18;
      const lev = debt > 0 && collUSD > debt ? collUSD / (collUSD - debt) : 1;
      const lt = Number(m?.liquidationThreshold || 8000) / 10000;
      const q = collUSD > 0 ? debt / collUSD : 0;
      return { totalCollateral: m?.collateralizedAmount || "0", totalDebt: liq?.totalAmountOwed || "0", effectiveLeverage: lev.toFixed(3), healthFactor: q > 0 ? (lt / q).toFixed(2) : "999" };
    }
    const vaults = await cdpGetVaults(accessToken, userAddress);
    const m = vaults.find((v: any) => v.asset?.toLowerCase() === asset.toLowerCase());
    if (!m) return { totalCollateral: "0", totalDebt: "0", effectiveLeverage: "1", healthFactor: "0" };
    const collUSD = Number(BigInt(m.collateralValueUSD || "0")) / 1e18;
    const debt = Number(BigInt(m.debtAmount || "0")) / 1e18;
    const lev = debt > 0 && collUSD > debt ? collUSD / (collUSD - debt) : 1;
    return { totalCollateral: m.collateralAmount || "0", totalDebt: m.debtAmount || "0", effectiveLeverage: lev.toFixed(3), healthFactor: m.healthFactor?.toFixed(2) || "0" };
  } catch { return { totalCollateral: "0", totalDebt: "0", effectiveLeverage: "0", healthFactor: "0" }; }
}

export async function getPosition(accessToken: string, userAddress: string): Promise<LoopPositionResponse> {
  const [colls, liq, cdpVaults, bs] = await Promise.all([
    lendingCollateralAndBalance(accessToken, userAddress),
    lendingLiquidityAndBalance(accessToken, userAddress),
    cdpGetVaults(accessToken, userAddress),
    getBootstrap(accessToken),
  ]);
  const totalDebt = BigInt(liq?.totalAmountOwed || "0");
  const yMap = new Map(bs.opportunities.map((o) => [o.asset.toLowerCase(), o]));

  const lending: LoopPositionEntry[] = (colls || [])
    .filter((c: any) => BigInt(c.collateralizedAmount || "0") > 0n)
    .map((c: any) => {
      const cUSD = Number(BigInt(c.collateralizedAmountValue || "0")) / 1e18;
      const d = Number(totalDebt) / 1e18;
      const q = cUSD > 0 ? d / cUSD : 0;
      const lev = q < 1 ? 1 / (1 - q) : 1;
      const y = yMap.get(c.address?.toLowerCase())?.baseYieldAPR || 0;
      const carry = lev * y - (lev - 1) * bs.routes.lending.borrowAPR - 2 * (lev - 1) * (bs.swapFeeBps / 10000) * 100;
      return { asset: c.address, symbol: c._symbol || "UNKNOWN", collateral: c.collateralizedAmount || "0", collateralUSD: c.collateralizedAmountValue || "0", debt: liq?.totalAmountOwed || "0", healthFactor: Number((Number(c.liquidationThreshold || 8000) / 10000 / (q || 1)).toFixed(2)), effectiveLTV: Math.round(q * 10000) / 10000, leverage: Math.round(lev * 1000) / 1000, estimatedCarryAPR: Math.round(carry * 1000) / 1000 };
    });

  const cdp = cdpVaults
    .filter((v: any) => BigInt(v.collateralAmount || "0") > 0n || BigInt(v.debtAmount || "0") > 0n)
    .map((v: any) => {
      const cUSD = Number(BigInt(v.collateralValueUSD || "0")) / 1e18;
      const d = Number(BigInt(v.debtAmount || "0")) / 1e18;
      const q = cUSD > 0 ? d / cUSD : 0;
      const lev = q < 1 ? 1 / (1 - q) : 1;
      const y = yMap.get(v.asset?.toLowerCase())?.baseYieldAPR || 0;
      const carry = lev * y - (lev - 1) * (v.stabilityFeeRate || bs.routes.cdp.stabilityAPR) - 2 * (lev - 1) * (bs.swapFeeBps / 10000) * 100;
      return { asset: v.asset, symbol: v.symbol || "UNKNOWN", collateral: v.collateralAmount || "0", collateralUSD: v.collateralValueUSD || "0", debt: v.debtAmount || "0", healthFactor: v.healthFactor || 0, effectiveLTV: Math.round(q * 10000) / 10000, leverage: Math.round(lev * 1000) / 1000, estimatedCarryAPR: Math.round(carry * 1000) / 1000, collateralizationRatio: v.collateralizationRatio || 0 };
    });
  return { lending, cdp };
}

async function unwindLendingLoop(accessToken: string, userAddress: string, req: LoopUnwindRequest, maxSteps: number): Promise<LoopStepResult[]> {
  const results: LoopStepResult[] = [];
  const reg = await getPool(accessToken, { select: `lendingPool:lendingPool_fkey(address,borrowableAsset),collateralVault:collateralVault_fkey(address)` });
  const borrowableAsset = reg.lendingPool?.borrowableAsset;
  if (!borrowableAsset) throw new Error("Lending pool not found");
  const swapPool = await findSwapPool(accessToken, req.asset, borrowableAsset);
  if (!swapPool) throw new Error(`No swap pool for ${req.asset} <-> ${borrowableAsset}`);

  for (let i = 0; i < maxSteps; i++) {
    const sn = i + 1;
    try {
      // Check current state
      const [cs, liq] = await Promise.all([
        lendingCollateralAndBalance(accessToken, userAddress),
        lendingLiquidityAndBalance(accessToken, userAddress),
      ]);
      const mt = (cs || []).find((c: any) => c.address?.toLowerCase() === req.asset.toLowerCase());
      const currentColl = BigInt(mt?.collateralizedAmount || "0");
      const currentDebt = BigInt(liq?.totalAmountOwed || "0");

      if (currentColl <= 0n) { results.push({ step: sn, action: "withdraw_collateral", status: "skipped", error: "No collateral remaining" }); break; }

      // If no debt, just withdraw all — no swap/repay needed
      if (currentDebt <= 0n) {
        const wr = await lendingWithdrawCollateralMax(accessToken, userAddress, req.asset);
        results.push({ step: sn, action: "withdraw_collateral", status: "success", txHash: wr.hash });
        break;
      }

      // Has debt: withdraw -> swap -> repay
      let wr;
      if (req.steps === "all" && i === maxSteps - 1) { wr = await lendingWithdrawCollateralMax(accessToken, userAddress, req.asset); }
      else {
        const amt = currentColl / BigInt(maxSteps - i);
        if (amt <= 0n) { results.push({ step: sn, action: "withdraw_collateral", status: "skipped", error: "Nothing to withdraw" }); break; }
        wr = await lendingWithdrawCollateral(accessToken, userAddress, req.asset, amt.toString());
      }
      results.push({ step: sn, action: "withdraw_collateral", status: "success", txHash: wr.hash });

      const br = await cirrus.get(accessToken, `/${Token}-_balances`, { params: { address: `eq.${req.asset}`, key: `eq.${userAddress}`, select: "value::text" } });
      const cb = br.data?.[0]?.value || "0";
      if (BigInt(cb) <= 0n) { results.push({ step: sn, action: "swap_to_usdst", status: "skipped", error: "No balance" }); break; }
      const sr = await executeSwap(accessToken, { poolAddress: swapPool.poolAddress, isAToB: swapPool.isAToB, amountIn: cb, minAmountOut: "1", deadline: Math.floor(Date.now() / 1000) + 300 }, userAddress);
      results.push({ step: sn, action: "swap_to_usdst", status: "success", txHash: sr.hash });

      if (req.steps === "all" && i === maxSteps - 1) { const r = await lendingRepayAll(accessToken, userAddress); results.push({ step: sn, action: "repay_debt", status: "success", txHash: r.hash }); }
      else {
        const ur = await cirrus.get(accessToken, `/${Token}-_balances`, { params: { address: `eq.${borrowableAsset}`, key: `eq.${userAddress}`, select: "value::text" } });
        const ra = ur.data?.[0]?.value || "0";
        if (BigInt(ra) <= 0n) { results.push({ step: sn, action: "repay_debt", status: "skipped", error: "No USDST" }); break; }
        const r = await lendingRepay(accessToken, userAddress, ra);
        results.push({ step: sn, action: "repay_debt", status: "success", txHash: r.hash });
      }
    } catch (err: any) { results.push({ step: sn, action: "unwind_step", status: "failed", error: err.message }); break; }
  }
  return results;
}

async function unwindCDPLoop(accessToken: string, userAddress: string, req: LoopUnwindRequest, maxSteps: number): Promise<LoopStepResult[]> {
  const results: LoopStepResult[] = [];
  const reg = await getCDPRegistry(accessToken, userAddress, {}, "loop-unwind");
  const usdstAddress = reg.usdst;
  if (!reg.cdpEngine?.address || !usdstAddress) throw new Error("CDP addresses not found");
  const swapPool = await findSwapPool(accessToken, req.asset, usdstAddress);
  if (!swapPool) throw new Error(`No swap pool for ${req.asset} <-> ${usdstAddress}`);

  for (let i = 0; i < maxSteps; i++) {
    const sn = i + 1;
    try {
      // Check current vault state to decide what to do
      const vaults = await cdpGetVaults(accessToken, userAddress);
      const vault = vaults.find((v: any) => v.asset?.toLowerCase() === req.asset.toLowerCase());
      const currentDebt = BigInt(vault?.debtAmount || "0");
      const currentColl = BigInt(vault?.collateralAmount || "0");

      if (currentColl <= 0n) { results.push({ step: sn, action: "withdraw_collateral", status: "skipped", error: "No collateral remaining" }); break; }

      // If no debt, just withdraw all collateral — no swap/repay needed
      if (currentDebt <= 0n) {
        const wr = await cdpWithdrawMax(accessToken, userAddress, { asset: req.asset });
        results.push({ step: sn, action: "withdraw_collateral", status: "success", txHash: wr.hash });
        break;
      }

      // Has debt: withdraw safe amount -> swap -> repay
      let wr;
      if (req.steps === "all" && i === maxSteps - 1) { wr = await cdpWithdrawMax(accessToken, userAddress, { asset: req.asset }); }
      else {
        const mw = await cdpGetMaxWithdraw(accessToken, userAddress, { asset: req.asset });
        const safeMax = (BigInt(mw.maxAmount) * 90n) / 100n;
        const amt = safeMax / BigInt(maxSteps - i);
        if (amt <= 0n) { results.push({ step: sn, action: "withdraw_collateral", status: "skipped", error: "Nothing safely withdrawable" }); break; }
        wr = await cdpWithdraw(accessToken, userAddress, { asset: req.asset, amount: amt.toString() });
      }
      results.push({ step: sn, action: "withdraw_collateral", status: "success", txHash: wr.hash });

      const br = await cirrus.get(accessToken, `/${Token}-_balances`, { params: { address: `eq.${req.asset}`, key: `eq.${userAddress}`, select: "value::text" } });
      const cb = br.data?.[0]?.value || "0";
      if (BigInt(cb) <= 0n) { results.push({ step: sn, action: "swap_to_usdst", status: "skipped", error: "No balance" }); break; }
      const sr = await executeSwap(accessToken, { poolAddress: swapPool.poolAddress, isAToB: swapPool.isAToB, amountIn: cb, minAmountOut: "1", deadline: Math.floor(Date.now() / 1000) + 300 }, userAddress);
      results.push({ step: sn, action: "swap_to_usdst", status: "success", txHash: sr.hash });

      if (req.steps === "all" && i === maxSteps - 1) { const r = await cdpRepayAll(accessToken, userAddress, { asset: req.asset }); results.push({ step: sn, action: "repay_debt", status: "success", txHash: r.hash }); }
      else {
        const ur = await cirrus.get(accessToken, `/${Token}-_balances`, { params: { address: `eq.${usdstAddress}`, key: `eq.${userAddress}`, select: "value::text" } });
        const ra = ur.data?.[0]?.value || "0";
        if (BigInt(ra) <= 0n) { results.push({ step: sn, action: "repay_debt", status: "skipped", error: "No USDST" }); break; }
        const r = await cdpRepay(accessToken, userAddress, { asset: req.asset, amount: ra });
        results.push({ step: sn, action: "repay_debt", status: "success", txHash: r.hash });
      }
    } catch (err: any) { results.push({ step: sn, action: "unwind_step", status: "failed", error: err.message }); break; }
  }
  return results;
}

export async function unwindLoop(accessToken: string, userAddress: string, req: LoopUnwindRequest): Promise<LoopExecuteResponse> {
  if (req.idempotencyKey) { const cached = idempotencyStore.get(req.idempotencyKey); if (cached) return cached; }
  const requestId = randomUUID();
  const bootstrap = await getBootstrap(accessToken);
  const maxSteps = req.steps === "all" ? LOOP_CONSTANTS.MAX_LOOPS : req.steps;
  const steps = req.routeType === "lending_loop"
    ? await unwindLendingLoop(accessToken, userAddress, req, maxSteps)
    : await unwindCDPLoop(accessToken, userAddress, req, maxSteps);
  const terminalState = await readTerminalState(accessToken, userAddress, req.routeType, req.asset);
  const response: LoopExecuteResponse = { requestId, routeType: req.routeType, bootstrapVersion: bootstrap.version, plannedSteps: maxSteps * 3, executedSteps: steps, terminalState };
  if (req.idempotencyKey) idempotencyStore.set(req.idempotencyKey, response);
  const txHashes = steps.filter((s) => s.txHash).map((s) => s.txHash!);
  const entry: LoopHistoryEntry = { requestId, routeType: req.routeType, asset: req.asset, amount: "unwind", loops: typeof req.steps === "number" ? req.steps : maxSteps, status: steps.some((s) => s.status === "success") ? "success" : "failed", txHashes, timestamp: new Date().toISOString() };
  const uh = historyStore.get(userAddress) || []; uh.unshift(entry); historyStore.set(userAddress, uh);
  return response;
}

export async function executeLoop(
  accessToken: string,
  userAddress: string,
  req: LoopExecuteRequest
): Promise<LoopExecuteResponse> {
  if (req.idempotencyKey) {
    const cached = idempotencyStore.get(req.idempotencyKey);
    if (cached) return cached;
  }

  const requestId = randomUUID();
  const bootstrap = await getBootstrap(accessToken);

  let steps: LoopStepResult[];

  if (req.dryRun) {
    steps = [{ step: 1, action: "dry_run_validation", status: "success" }];
  } else if (req.routeType === "lending_loop") {
    steps = await executeLendingLoop(accessToken, userAddress, req);
  } else {
    steps = await executeCDPLoop(accessToken, userAddress, req);
  }

  const terminalState = req.dryRun
    ? { totalCollateral: "0", totalDebt: "0", effectiveLeverage: "0", healthFactor: "0" }
    : await readTerminalState(accessToken, userAddress, req.routeType, req.asset);

  const successCount = steps.filter((s) => s.status === "success").length;
  const overallStatus: "success" | "partial" | "failed" =
    successCount === 0 ? "failed" : successCount < req.loops * 3 ? "partial" : "success";

  const response: LoopExecuteResponse = {
    requestId,
    routeType: req.routeType,
    bootstrapVersion: bootstrap.version,
    plannedSteps: req.loops * 3,
    executedSteps: steps,
    terminalState,
  };

  if (req.idempotencyKey) idempotencyStore.set(req.idempotencyKey, response);

  const txHashes = steps.filter((s) => s.txHash).map((s) => s.txHash!);
  const entry: LoopHistoryEntry = { requestId, routeType: req.routeType, asset: req.asset, amount: req.amount, loops: req.loops, status: overallStatus, txHashes, timestamp: new Date().toISOString() };
  const userHistory = historyStore.get(userAddress) || [];
  userHistory.unshift(entry);
  historyStore.set(userAddress, userHistory);

  return response;
}

export function getHistory(userAddress: string): LoopHistoryEntry[] {
  return historyStore.get(userAddress) || [];
}
