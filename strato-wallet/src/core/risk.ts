// Liquidation-risk health, computed directly from Cirrus-indexed state (prices,
// debt, collateral) instead of an on-chain eth_call. Reading the pushed price feed
// straight from BlockApps-PriceOracle-prices is the consistent source of truth and
// avoids the transient/odd readings the contract's getHealthFactor /
// collateralizationRatio path produced.
//
// Health factor is normalized so 1e18 == exactly the liquidation threshold:
//   CDP:     health = (collateralUSD / debtUSD) / liquidationRatio
//   Lending: health = Σ(collateralUSD_i · liquidationThreshold_i) / debtUSD   (Aave-style)
// Below 1e18 = liquidatable.
//
// Interest: LendingPool debt accrues 5%/yr from userLoan.lastUpdated. CDP debt is
// the vault's scaledDebt × the asset's rateAccumulator (from collateralGlobalStates,
// RAY-scaled) — i.e. the indexed debt at the last accrual — then compounded forward
// at an assumed 2%/yr from that lastAccrual to now.

import type { StratoNetwork } from "./networks";

/** 1e18-scaled health where 1e18 = the liquidation threshold. */
export const HEALTH_SCALE = 10n ** 18n;
const RAY = 10n ** 27n; // CDP rateAccumulator scale

const SECONDS_PER_YEAR = 365.25 * 24 * 3600;
const LENDING_APR_BPS = 500; // 5% assumed on LendingPool loans
const CDP_APR_BPS = 200; // 2% assumed on CDP loans (forward from lastAccrual)

export interface RiskData {
  /** collateral asset (lowercased, no 0x) -> price * 1e18 (USD per token). */
  prices: Map<string, bigint>;
  /** `${engine}:${asset}` -> CDP liquidationRatio (1e18) + unitScale. */
  cdpConfig: Map<string, { liq: bigint; unit: bigint }>;
  /** `${engine}:${asset}` -> CDP global accrual: rateAccumulator (RAY) + lastAccrual (unix s). */
  cdpGlobal: Map<string, { rate: bigint; lastAccrual: bigint }>;
  /** asset -> LendingPool liquidationThreshold in basis points (e.g. 8000 = 80%). */
  lendingLiqBps: Map<string, bigint>;
  /** asset -> token symbol. */
  symbols: Map<string, string>;
}

export interface CdpPosition {
  engine: string; // 0x
  asset: string; // lowercased, no 0x
  symbol: string;
  healthFactor: bigint; // 1e18-scaled
}

export interface LoanHealth {
  healthFactor: bigint; // 1e18-scaled
  hasDebt: boolean;
}

function cirrus(n: StratoNetwork): string {
  return `${new URL(n.rpcUrl).origin}/cirrus/search`;
}
const noPrefix = (a: string): string => a.replace(/^0x/, "").toLowerCase();

async function getJson(url: string): Promise<unknown> {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/**
 * Network-wide reference data (prices + configs + symbols), fetched once per poll
 * and shared across all accounts. Returns null if prices are unavailable (e.g. an
 * auth-gated testnet Cirrus), in which case risk watching is skipped for the net.
 */
export async function fetchRiskData(network: StratoNetwork): Promise<RiskData | null> {
  const base = cirrus(network);
  const [priceRows, cdpCfgRows, cdpGsRows, lendCfgRows] = await Promise.all([
    getJson(`${base}/BlockApps-PriceOracle-prices?select=key,value`),
    getJson(`${base}/BlockApps-CDPEngine-collateralConfigs?select=address,asset:key,CollateralConfig:value`),
    getJson(`${base}/BlockApps-CDPEngine-collateralGlobalStates?select=address,asset:key,CollateralGlobalState:value`),
    getJson(`${base}/BlockApps-LendingPool-assetConfigs?select=key,value`),
  ]);
  if (!Array.isArray(priceRows)) return null;

  const prices = new Map<string, bigint>();
  for (const r of priceRows as any[]) {
    try {
      prices.set(noPrefix(String(r.key)), BigInt(r.value));
    } catch {
      /* skip bad row */
    }
  }

  const cdpConfig = new Map<string, { liq: bigint; unit: bigint }>();
  if (Array.isArray(cdpCfgRows)) {
    for (const r of cdpCfgRows as any[]) {
      try {
        cdpConfig.set(`${noPrefix(String(r.address))}:${noPrefix(String(r.asset))}`, {
          liq: BigInt(r.CollateralConfig?.liquidationRatio ?? "0"),
          unit: BigInt(r.CollateralConfig?.unitScale ?? "0"),
        });
      } catch {
        /* skip */
      }
    }
  }

  const cdpGlobal = new Map<string, { rate: bigint; lastAccrual: bigint }>();
  if (Array.isArray(cdpGsRows)) {
    for (const r of cdpGsRows as any[]) {
      try {
        cdpGlobal.set(`${noPrefix(String(r.address))}:${noPrefix(String(r.asset))}`, {
          rate: BigInt(r.CollateralGlobalState?.rateAccumulator ?? "0"),
          lastAccrual: BigInt(r.CollateralGlobalState?.lastAccrual ?? "0"),
        });
      } catch {
        /* skip */
      }
    }
  }

  const lendingLiqBps = new Map<string, bigint>();
  if (Array.isArray(lendCfgRows)) {
    for (const r of lendCfgRows as any[]) {
      try {
        lendingLiqBps.set(noPrefix(String(r.key)), BigInt(r.value?.liquidationThreshold ?? "0"));
      } catch {
        /* skip */
      }
    }
  }

  const symbols = new Map<string, string>();
  const assetList = [...prices.keys()];
  if (assetList.length) {
    const toks = await getJson(
      `${base}/BlockApps-Token?select=address,_symbol&address=in.(${assetList.join(",")})`
    );
    if (Array.isArray(toks)) {
      for (const t of toks as any[]) symbols.set(noPrefix(String(t.address)), String(t._symbol ?? ""));
    }
  }

  return { prices, cdpConfig, cdpGlobal, lendingLiqBps, symbols };
}

/** Grow a principal by a flat APR over elapsed time (approximation of the index). */
function accrue(principal: bigint, lastUpdatedSec: bigint, aprBps: number): bigint {
  if (principal <= 0n || lastUpdatedSec <= 0n) return principal;
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - Number(lastUpdatedSec));
  const growthWad = Math.floor((aprBps / 10000) * (elapsed / SECONDS_PER_YEAR) * 1e18);
  return principal + (principal * BigInt(growthWad)) / HEALTH_SCALE;
}

/** A user's CDP positions that carry debt, with normalized health factors. */
export async function fetchCdpPositions(
  network: StratoNetwork,
  user: string,
  data: RiskData
): Promise<CdpPosition[]> {
  const u = noPrefix(user);
  const vaults = await getJson(
    `${cirrus(network)}/BlockApps-CDPEngine-vaults?select=address,asset:key2,Vault:value&key=eq.${u}`
  );
  if (!Array.isArray(vaults)) return [];

  const out: CdpPosition[] = [];
  for (const v of vaults as any[]) {
    let scaledDebt: bigint, collateral: bigint;
    try {
      scaledDebt = BigInt(v.Vault?.scaledDebt ?? "0"); // index-scaled (USD * 1e18 at index 1.0)
      collateral = BigInt(v.Vault?.collateral ?? "0"); // token base units
    } catch {
      continue;
    }
    if (scaledDebt <= 0n) continue;

    const engine = noPrefix(String(v.address));
    const asset = noPrefix(String(v.asset));
    const cfg = data.cdpConfig.get(`${engine}:${asset}`);
    const price = data.prices.get(asset);
    if (!cfg || cfg.liq <= 0n || !price) continue;

    // Current debt = scaledDebt × rateAccumulator/RAY (debt at last accrual), then
    // compounded forward at the assumed APR from lastAccrual to now.
    const gs = data.cdpGlobal.get(`${engine}:${asset}`);
    let debt = gs && gs.rate > 0n ? (scaledDebt * gs.rate) / RAY : scaledDebt;
    if (gs) debt = accrue(debt, gs.lastAccrual, CDP_APR_BPS);
    if (debt <= 0n) continue;

    const unit = cfg.unit > 0n ? cfg.unit : HEALTH_SCALE;
    const collateralUSD = (collateral * price) / unit; // USD * 1e18
    const cr = (collateralUSD * HEALTH_SCALE) / debt; // 1e18
    const healthFactor = (cr * HEALTH_SCALE) / cfg.liq; // 1e18

    out.push({ engine: `0x${engine}`, asset, symbol: data.symbols.get(asset) || "collateral", healthFactor });
  }
  return out;
}

/** Aggregate LendingPool health for a user (Aave-style across all collateral). */
export async function fetchLoanHealth(
  network: StratoNetwork,
  user: string,
  data: RiskData
): Promise<LoanHealth | null> {
  const u = noPrefix(user);
  const [loans, colls] = await Promise.all([
    getJson(`${cirrus(network)}/BlockApps-LendingPool-userLoan?select=value&key=eq.${u}`),
    getJson(`${cirrus(network)}/BlockApps-CollateralVault-userCollaterals?select=key2,value&key=eq.${u}`),
  ]);

  const loan = Array.isArray(loans) ? (loans[0] as any) : null;
  let scaledDebt = 0n;
  let lastUpdated = 0n;
  try {
    scaledDebt = BigInt(loan?.value?.scaledDebt ?? "0"); // USDST (~USD) * 1e18
    lastUpdated = BigInt(loan?.value?.lastUpdated ?? "0");
  } catch {
    /* keep 0 */
  }
  if (scaledDebt <= 0n) return { healthFactor: 0n, hasDebt: false };

  const debtUSD = accrue(scaledDebt, lastUpdated, LENDING_APR_BPS);
  if (debtUSD <= 0n) return { healthFactor: 0n, hasDebt: false };

  let weighted = 0n; // Σ collateralUSD · liquidationThreshold
  if (Array.isArray(colls)) {
    for (const c of colls as any[]) {
      const asset = noPrefix(String(c.key2));
      let amt: bigint;
      try {
        amt = BigInt(c.value ?? "0");
      } catch {
        continue;
      }
      if (amt <= 0n) continue;
      const price = data.prices.get(asset);
      const liqBps = data.lendingLiqBps.get(asset);
      if (!price || !liqBps) continue;
      const collUSD = (amt * price) / HEALTH_SCALE; // assume 18-decimal collateral
      weighted += (collUSD * liqBps) / 10000n;
    }
  }

  return { healthFactor: (weighted * HEALTH_SCALE) / debtUSD, hasDebt: true };
}
