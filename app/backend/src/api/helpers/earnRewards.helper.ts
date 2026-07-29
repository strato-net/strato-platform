import stakeSemanticsConfig from "../services/rewardsStakeSemantics.json";
import { safeBigInt } from "./vaultPerformance.helper";
import { constants } from "../../config/constants";

const { DECIMALS, BPS_DIVISOR } = constants;

// ── Constants ─────────────────────────────────────────────────────────────────

export const APY_UNAVAILABLE = "-";
const CATA_PRICE_USD = 0.9;
const SECONDS_PER_YEAR = 86400 * 365;

const STAKE_SEMANTICS = stakeSemanticsConfig as any;
const toAddressSet = (keys: string[]) => new Set(keys.map(normalizeAddress));
const USD_NOTIONAL_SWAP_SOURCES = toAddressSet(STAKE_SEMANTICS.usd_notional.swapSources);
const USD_NOTIONAL_DEPOSIT_COMPLETED_SOURCES = toAddressSet(STAKE_SEMANTICS.usd_notional.depositCompletedSources);
const USD_NOTIONAL_AMOUNT_USD_SOURCES = toAddressSet(STAKE_SEMANTICS.usd_notional.amountUsdSources);
const TOKEN_UNITS_SOURCES = toAddressSet(STAKE_SEMANTICS.token_units.lpMintBurnSources);

// ── Utilities ─────────────────────────────────────────────────────────────────

export function normalizeAddress(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/^0x/, "");
}

export function isPositiveApy(s: string | null | undefined): s is string {
  return !!s && s !== APY_UNAVAILABLE && parseFloat(s) > 0;
}

function getPriceForAddress(priceMap: Map<string, string>, address?: string | null): string | null {
  if (!address) return null;
  return priceMap.get(address) ?? priceMap.get(normalizeAddress(address)) ?? null;
}

export function toUsdValue(amountWei: string, priceWei: string): string {
  const amount = BigInt(amountWei || "0");
  const price = BigInt(priceWei || "0");
  if (amount === 0n || price === 0n) return "0";
  return ((amount * price) / DECIMALS).toString();
}

export function parseMappingValue(raw: string): any | null {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// ── Reward activity builders ──────────────────────────────────────────────────

export function buildRewardActivitiesFromMappings(
  activityCfgById: Map<string, any>,
  activityStateById: Map<string, any>,
  pricingCtx: {
    priceMap: Map<string, string>;
    mTokenAddress: string | null;
    sTokenAddress: string | null;
    vaultShareTokenAddress: string | null;
    saveUsdstVaultAddress: string | null;
    carryVaultUsdPriceMap?: Map<string, string>;
  },
): any[] {
  const saveUsdstSource = normalizeAddress(pricingCtx.saveUsdstVaultAddress);
  const activities: any[] = [];
  for (const [activityId, activity] of activityCfgById.entries()) {
    const state = activityStateById.get(activityId);
    const sourceContract = String(activity?.sourceContract ?? "");
    const totalStake = String(state?.totalStake ?? "0");
    const name = String(activity?.name ?? "");
    const emissionRate = String(activity?.emissionRate ?? "0");

    const { stakeAssetAddress, totalStakeUsd } = computeRewardStakeUsd(sourceContract, name, totalStake, pricingCtx, saveUsdstSource);

    activities.push({
      activityId: Number(activityId), name, emissionRate, sourceContract, stakeAssetAddress, totalStake, totalStakeUsd,
      _srcNorm: normalizeAddress(sourceContract),
      _stakeNorm: normalizeAddress(stakeAssetAddress),
    });
  }
  return activities;
}

function computeRewardStakeUsd(
  sourceContractRaw: string, name: string, totalStake: string,
  ctx: { priceMap: Map<string, string>; mTokenAddress: string | null; sTokenAddress: string | null; vaultShareTokenAddress: string | null; carryVaultUsdPriceMap?: Map<string, string> },
  saveUsdstSource: string,
): { stakeAssetAddress: string | null; totalStakeUsd: string | null } {
  const sourceContract = normalizeAddress(sourceContractRaw);

  if (USD_NOTIONAL_SWAP_SOURCES.has(sourceContract) || USD_NOTIONAL_DEPOSIT_COMPLETED_SOURCES.has(sourceContract) || USD_NOTIONAL_AMOUNT_USD_SOURCES.has(sourceContract))
    return { stakeAssetAddress: null, totalStakeUsd: totalStake || "0" };

  // STRATO staking: the activity's stake is in STRATO token units, but the
  // source is the staking contract, so the price lookup must go through the
  // configured STRATO token rather than the source address itself.
  const stratoStakingSource = normalizeAddress(constants.stratoStaking);
  if (stratoStakingSource && sourceContract === stratoStakingSource) {
    const stratoToken = normalizeAddress(constants.stratoToken);
    const stratoPrice = getPriceForAddress(ctx.priceMap, stratoToken);
    return {
      stakeAssetAddress: stratoToken || null,
      totalStakeUsd: stratoPrice ? toUsdValue(totalStake, stratoPrice) : null,
    };
  }

  const stakeAssetAddress = TOKEN_UNITS_SOURCES.has(sourceContract) || (saveUsdstSource && sourceContract === saveUsdstSource)
    ? sourceContract : null;

  const directStakePrice = stakeAssetAddress ? getPriceForAddress(ctx.priceMap, stakeAssetAddress) : null;
  if (directStakePrice) return { stakeAssetAddress, totalStakeUsd: toUsdValue(totalStake, directStakePrice) };

  // Carry yield vaults (eth-carry, wbtc-carry): stake is in share units and the
  // USD-per-share is precomputed against the asset's oracle price. Must precede
  // the generic `lower.includes("vault")` branch, which would otherwise route
  // the carry vault through the main protocol vault's share-token price.
  if (ctx.carryVaultUsdPriceMap) {
    const carryUsdPrice = ctx.carryVaultUsdPriceMap.get(sourceContract);
    if (carryUsdPrice && carryUsdPrice !== "0") {
      return { stakeAssetAddress: sourceContract, totalStakeUsd: toUsdValue(totalStake, carryUsdPrice) };
    }
  }

  const lower = name.toLowerCase();
  if (lower.includes("safety")) {
    const p = getPriceForAddress(ctx.priceMap, ctx.sTokenAddress);
    if (p) return { stakeAssetAddress, totalStakeUsd: toUsdValue(totalStake, p) };
  }
  if (lower.includes("lending pool liquidity")) {
    const p = getPriceForAddress(ctx.priceMap, ctx.mTokenAddress);
    if (p) return { stakeAssetAddress, totalStakeUsd: toUsdValue(totalStake, p) };
  }
  if (lower.includes("borrow")) return { stakeAssetAddress, totalStakeUsd: totalStake || "0" };
  if (lower.includes("vault")) {
    const p = getPriceForAddress(ctx.priceMap, ctx.vaultShareTokenAddress);
    if (p) return { stakeAssetAddress, totalStakeUsd: toUsdValue(totalStake, p) };
  }

  return { stakeAssetAddress, totalStakeUsd: null };
}

// ── Reward APY computation ────────────────────────────────────────────────────

export function computeRewardsApy(emissionRateRaw?: string, totalStakeUsdRaw?: string | null): string | null {
  try {
    if (!emissionRateRaw || !totalStakeUsdRaw) return null;
    const emissionRate = BigInt(emissionRateRaw);
    const totalStakeUsd = BigInt(totalStakeUsdRaw);
    if (emissionRate <= 0n || totalStakeUsd <= 0n) return null;

    const tvlUsd = Number(totalStakeUsd) / 1e18;
    const annualCata = (Number(emissionRate) / 1e18) * SECONDS_PER_YEAR;
    if (!isFinite(tvlUsd) || tvlUsd <= 0 || !isFinite(annualCata) || annualCata <= 0) return null;

    const apy = ((annualCata * CATA_PRICE_USD) / tvlUsd) * 100;
    return apy > 0 && isFinite(apy) ? apy.toFixed(2) : null;
  } catch {
    return null;
  }
}

// ── Reward activity finders (use pre-normalized _srcNorm / _stakeNorm) ────────

export function findRewardActivity(
  activities: any[],
  options: { sourceContract?: string | null; stakeAssetAddress?: string | null; nameIncludes?: string[] },
): any | null {
  const src = normalizeAddress(options.sourceContract);
  const stake = normalizeAddress(options.stakeAssetAddress);
  const nameMatchers = (options.nameIncludes ?? []).map(n => n.toLowerCase());

  const matches = activities.filter(a => {
    if (src && a._srcNorm !== src) return false;
    if (stake && a._stakeNorm && a._stakeNorm !== stake) return false;
    if (nameMatchers.length > 0 && !nameMatchers.some(m => String(a?.name ?? "").toLowerCase().includes(m))) return false;
    return true;
  });

  if (matches.length === 0) return null;
  return matches.find(a => stake && a._stakeNorm === stake)
    ?? matches.find(a => safeBigInt(a?.totalStakeUsd ?? "0") > 0n)
    ?? matches[0];
}

export function findPoolRewardActivity(
  activities: any[],
  options: { poolAddress?: string | null; lpTokenAddress?: string | null },
): any | null {
  const pool = normalizeAddress(options.poolAddress);
  const lp = normalizeAddress(options.lpTokenAddress);

  const matches = activities.filter(a =>
    (pool && a._srcNorm === pool) || (lp && a._srcNorm === lp) || (lp && a._stakeNorm === lp)
  );

  if (matches.length === 0) return null;
  return matches.find(a => lp && a._stakeNorm === lp)
    ?? matches.find(a => pool && a._srcNorm === pool)
    ?? matches.find(a => safeBigInt(a?.totalStakeUsd ?? "0") > 0n)
    ?? matches[0];
}
