/**
 * Portfolio grouping: map every holding/position to a canonical "underlying
 * asset" group so the tracker reads like a brokerage account (ETHST holding +
 * ETH carry vault + ETH CDP collateral all roll up under "ETH"; the USDST
 * family rolls up under "USDST").
 *
 * Pure module — no React, no network — so `deriveUnderlying` / `buildGroups`
 * can be unit-tested directly.
 */
import {
  usdstAddress,
  sUsdstAddress,
  mUsdstAddress,
  safetyModuleAddress,
  cataAddress,
} from "@/lib/constants";
import type {
  GroupKey,
  PortfolioGroup,
  PortfolioPosition,
} from "@/interface/portfolio";

const norm = (v?: string | null): string =>
  (v || "").toLowerCase().replace(/^0x/, "");

/** Address → canonical group. Keyed by lowercased, 0x-stripped address. */
export const UNDERLYING_ADDRESS_OVERRIDES: Record<string, GroupKey> = {
  [norm(usdstAddress)]: "USDST",
  [norm(sUsdstAddress)]: "USDST",
  [norm(mUsdstAddress)]: "USDST",
  [norm(safetyModuleAddress)]: "USDST",
  [norm(cataAddress)]: "CATA",
};

/** Symbol → canonical group. Keyed by lowercased symbol. */
export const UNDERLYING_OVERRIDES: Record<string, GroupKey> = {
  // USDST family
  usdst: "USDST",
  susdst: "USDST",
  musdst: "USDST",
  lendusdst: "USDST",
  safetyusdst: "USDST",
  saveusdst: "USDST",
  // carry / yield vault share tokens -> their underlying
  carryeth: "ETH",
  carrywbtc: "BTC",
  yieldusdc: "USDC",
  // metals
  goldst: "GOLD",
  silvst: "SILV",
  // wrapped assets
  wbtc: "BTC",
  cata: "CATA",
};

export interface DeriveUnderlyingInput {
  address?: string | null;
  symbol?: string | null;
  name?: string | null;
  rebasingExternalSymbol?: string | null;
  isPoolToken?: boolean | null;
}

/** Stablecoin / USDST-family symbols — used to pick the "primary" leg of an LP. */
const STABLE_SYMBOLS = new Set([
  "usdst",
  "susdst",
  "musdst",
  "lendusdst",
  "safetyusdst",
  "susds",
  "syrupusdc",
  "usdc",
  "usdt",
  "dai",
]);

/**
 * For an LP symbol like "ETH-USDST-LP" or "SILVST-USDST-LP", return the
 * underlying group of its primary (first non-stablecoin) leg, so the LP is
 * filed under that asset (ETH-USDST-LP → ETH, SILVST-USDST-LP → SILV). If every
 * leg is a stablecoin (e.g. SYRUPUSDC-SUSDS-USDST-LP), fall back to USDST.
 */
const underlyingFromLpSymbol = (symbol: string): GroupKey => {
  const legs = symbol
    .split("-")
    .filter((p) => p && p.toUpperCase() !== "LP");
  const primary = legs.find((leg) => !STABLE_SYMBOLS.has(leg.toLowerCase()));
  if (primary) return deriveUnderlying({ symbol: primary });
  return "USDST";
};

/**
 * Resolve the canonical underlying group for a holding/position.
 *
 * Precedence: address override → symbol override → LP primary leg →
 * rebasingExternalSymbol → strip trailing "ST" → raw symbol uppercased.
 */
export const deriveUnderlying = (input: DeriveUnderlyingInput): GroupKey => {
  const addr = norm(input.address);
  if (addr && UNDERLYING_ADDRESS_OVERRIDES[addr]) {
    return UNDERLYING_ADDRESS_OVERRIDES[addr];
  }

  const symbol = (input.symbol || "").trim();
  const symbolLower = symbol.toLowerCase();
  if (symbolLower && UNDERLYING_OVERRIDES[symbolLower]) {
    return UNDERLYING_OVERRIDES[symbolLower];
  }

  // LP tokens ("A-B-LP") group under their primary (non-stablecoin) leg.
  if (/-lp$/i.test(symbol)) {
    return underlyingFromLpSymbol(symbol);
  }

  const rebasing = (input.rebasingExternalSymbol || "").trim();
  if (rebasing) return rebasing.toUpperCase();

  // Strip a trailing STRATO "ST" suffix: ETHST -> ETH, GOLDST -> GOLD.
  if (/ST$/i.test(symbol) && symbol.length > 2) {
    return symbol.slice(0, -2).toUpperCase();
  }

  return symbol ? symbol.toUpperCase() : "OTHER";
};

export type AssetCategory = "Metals" | "Stocks" | "Crypto";

/** Precious-metal underlyings. */
const METAL_KEYS = new Set<GroupKey>(["GOLD", "SILV", "SILVER", "PLAT", "PALL"]);

/**
 * Tokenized-equity (stock) underlyings. Mercata equity tokens use ticker-style
 * symbols (e.g. SPYX, TSLAX, ARBV). Extend this set as new equities are listed.
 */
const STOCK_KEYS = new Set<GroupKey>([
  "SPYX",
  "TSLAX",
  "ARBV",
  "BCSPX",
  "NVDAX",
  "AAPLX",
  "MSFTX",
  "AMZNX",
  "GOOGLX",
  "METAX",
  "COINX",
  "QQQX",
]);

/** Classify an underlying group into a top-level asset category. */
export const categoryOf = (key: GroupKey): AssetCategory => {
  const k = key.toUpperCase();
  if (METAL_KEYS.has(k)) return "Metals";
  if (STOCK_KEYS.has(k)) return "Stocks";
  return "Crypto";
};

/** Display order for categories. */
export const CATEGORY_ORDER: AssetCategory[] = ["Crypto", "Metals", "Stocks"];

/** Friendly display label for a group key. */
export const groupLabel = (key: GroupKey): string => {
  switch (key) {
    case "LP":
      return "Liquidity Pools";
    case "BTC":
      return "Bitcoin";
    case "ETH":
      return "Ethereum";
    case "GOLD":
      return "Gold";
    case "SILV":
      return "Silver";
    case "OTHER":
      return "Other";
    default:
      return key;
  }
};

/** A position tagged with its resolved group, ready for aggregation. */
export type TaggedPosition = PortfolioPosition & { groupKey: GroupKey };

/**
 * Reduce tagged positions into sorted `PortfolioGroup`s with totals, blended
 * APY, allocation %, and estimated P&L rollups. Pure and side-effect free.
 */
export const buildGroups = (positions: TaggedPosition[]): PortfolioGroup[] => {
  const byKey = new Map<GroupKey, TaggedPosition[]>();
  for (const pos of positions) {
    const list = byKey.get(pos.groupKey);
    if (list) list.push(pos);
    else byKey.set(pos.groupKey, [pos]);
  }

  const groups: PortfolioGroup[] = [];
  for (const [key, list] of byKey) {
    let grossValueUsd = 0;
    let debtUsd = 0;
    let apyWeight = 0;
    let apyWeightedSum = 0;
    let investedUsd = 0;
    let unrealizedUsd = 0;
    let hasPnl = false;

    for (const pos of list) {
      if (pos.valueUsd >= 0) {
        grossValueUsd += pos.valueUsd;
        if (pos.apy != null && pos.valueUsd > 0) {
          apyWeight += pos.valueUsd;
          apyWeightedSum += pos.valueUsd * pos.apy;
        }
      } else {
        debtUsd += -pos.valueUsd;
      }
      if (pos.investedUsd != null || pos.unrealizedUsd != null) {
        hasPnl = true;
        investedUsd += pos.investedUsd ?? 0;
        unrealizedUsd += pos.unrealizedUsd ?? 0;
      }
    }

    const sortedPositions = [...list].sort((a, b) => b.valueUsd - a.valueUsd);

    groups.push({
      key,
      label: groupLabel(key),
      category: categoryOf(key),
      totalValueUsd: grossValueUsd - debtUsd,
      grossValueUsd,
      debtUsd,
      blendedApy: apyWeight > 0 ? apyWeightedSum / apyWeight : null,
      allocationPct: 0, // filled in below once total gross is known
      positions: sortedPositions,
      investedUsd: hasPnl ? investedUsd : null,
      unrealizedUsd: hasPnl ? unrealizedUsd : null,
      unrealizedPct:
        hasPnl && investedUsd > 0 ? (unrealizedUsd / investedUsd) * 100 : null,
    });
  }

  const totalGross = groups.reduce((sum, g) => sum + g.grossValueUsd, 0);
  for (const g of groups) {
    g.allocationPct = totalGross > 0 ? (g.grossValueUsd / totalGross) * 100 : 0;
  }

  return groups.sort((a, b) => b.totalValueUsd - a.totalValueUsd);
};
