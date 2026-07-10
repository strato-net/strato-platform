import { useMemo } from "react";
import { formatUnits } from "viem";
import type { EarningAsset } from "@mercata/shared-types";
import { useTokenContext } from "@/context/TokenContext";
import { useCDP } from "@/context/CDPContext";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import {
  buildGroups,
  deriveUnderlying,
  type TaggedPosition,
} from "@/lib/portfolioGrouping";
import type { NetFlowsByAddress } from "@/hooks/usePortfolioPnL";
import type { PortfolioSummary, PositionKind } from "@/interface/portfolio";

const CARRY_VAULT_SHARE_MAP: Record<string, string> = {
  carryeth: "eth-carry",
  carrywbtc: "wbtc-carry",
  yieldusdc: "usdc-yield",
};

const norm = (v?: string | null): string =>
  (v || "").toLowerCase().replace(/^0x/, "");

const isSaveUsdst = (a: EarningAsset): boolean => {
  const s = (a._symbol || "").toLowerCase();
  const n = (a._name || "").toLowerCase();
  return s === "saveusdst" || n.includes("save usdst") || n.includes("saveusdst");
};

const isLp = (a: EarningAsset): boolean =>
  !!a._symbol?.endsWith("-LP") || a.description === "Liquidity Provider Token";

/** Classify an earning asset into a position kind + human label + detail href. */
const classifyAsset = (
  a: EarningAsset
): { kind: PositionKind; label: string; href?: string } => {
  const symbol = a._symbol || a._name || "Asset";
  const symbolLower = (a._symbol || "").toLowerCase();

  if (isSaveUsdst(a)) {
    return { kind: "saveVault", label: "Save USDST Vault", href: "/dashboard/earn-save" };
  }
  const carryKey = CARRY_VAULT_SHARE_MAP[symbolLower];
  if (carryKey) {
    const kind: PositionKind = carryKey === "usdc-yield" ? "yieldVault" : "carryVault";
    return { kind, label: a._name || `${symbol} Vault`, href: `/dashboard/earn-yield-vault?vault=${carryKey}` };
  }
  if (symbolLower === "safetyusdst") {
    return { kind: "safetyStake", label: "Safety Module Stake", href: "/dashboard/earn" };
  }
  if (isLp(a)) {
    return { kind: "lpPool", label: `${symbol} Pool`, href: `/dashboard/deposits/${a.address}` };
  }
  return { kind: "holding", label: symbol, href: `/dashboard/deposits/${a.address}` };
};

const toNum = (v?: string | null): number => {
  const n = parseFloat(v || "0");
  return Number.isFinite(n) ? n : 0;
};

/** Fraction of the current balance that was net-deposited (0..~), decimals-agnostic. */
const depositedRatio = (netDepositedRaw?: string, currentRaw?: string): number | null => {
  if (!netDepositedRaw) return null;
  let net: bigint;
  let cur: bigint;
  try {
    net = BigInt(netDepositedRaw);
    cur = BigInt(currentRaw || "0");
  } catch {
    return null;
  }
  if (net <= 0n || cur <= 0n) return null;
  // Scale to keep precision through the integer division.
  const SCALE = 1_000_000n;
  const ratio = Number((net * SCALE) / cur) / Number(SCALE);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  // Clamp against absurd values from rebase/exchange-rate artifacts.
  return Math.min(ratio, 5);
};

/**
 * Aggregate the various data contexts into a brokerage-style `PortfolioSummary`:
 * assets from `earningAssets` (whose USD `value` already includes any locked
 * collateral, server-side), liabilities from CDP vault debt and the lending
 * borrow position. Grouped by underlying via `deriveUnderlying`.
 *
 * Purely derives from already-mounted, already-polling contexts — no new fetch.
 * Optionally merges the flows-based estimated P&L from `usePortfolioPnL`.
 */
export const usePortfolio = (flows?: NetFlowsByAddress): PortfolioSummary => {
  const {
    earningAssets,
    loadingEarningAssets,
    netBalance,
    totalBorrowed,
    loadingNetBalance,
  } = useTokenContext();
  const { vaults } = useCDP();
  const { loans } = useLendingContext();
  const { isLoggedIn } = useUser();

  return useMemo(() => {
    const positions: TaggedPosition[] = [];

    // ----- Asset positions (from earning assets) -----
    for (const a of earningAssets) {
      const valueUsd = toNum(a.value);
      if (valueUsd <= 0 && (a.totalBalance === "0" || !a.totalBalance)) continue;

      const { kind, label, href } = classifyAsset(a);
      const groupKey = deriveUnderlying({
        address: a.address,
        symbol: a._symbol,
        name: a._name,
        rebasingExternalSymbol: a.rebasingExternalSymbol,
      });

      // Flows-based estimated P&L: invested ≈ fraction of holding that was
      // deposited (vs. accrued), unrealized = current value − invested.
      const balanceRaw = a.totalBalance || a.balance || "0";
      const ratio = flows ? depositedRatio(flows[norm(a.address)], balanceRaw) : null;
      let investedUsd: number | null = null;
      let unrealizedUsd: number | null = null;
      let unrealizedPct: number | null = null;
      if (ratio != null) {
        investedUsd = valueUsd * ratio;
        unrealizedUsd = valueUsd - investedUsd;
        unrealizedPct = investedUsd > 0 ? (unrealizedUsd / investedUsd) * 100 : null;
      }

      positions.push({
        id: `${kind}:${a.address}`,
        kind,
        label,
        symbol: a._symbol || a._name || "",
        address: a.address,
        balanceRaw,
        decimals: a.customDecimals || 18,
        valueUsd,
        apy: a.apy != null && a.apy !== "" ? toNum(a.apy) : null,
        href,
        imageUrl: a.images?.[0]?.value,
        investedUsd,
        unrealizedUsd,
        unrealizedPct,
        groupKey,
      });
    }

    // ----- Liability: CDP vault debt (USDST owed), grouped under collateral asset -----
    for (const v of vaults) {
      let debt = 0;
      try {
        debt = parseFloat(formatUnits(BigInt(v.debtAmount || "0"), 18));
      } catch {
        debt = 0;
      }
      if (debt <= 0) continue;
      positions.push({
        id: `cdpDebt:${v.asset}`,
        kind: "cdpDebt",
        label: `${v.symbol} Vault Debt`,
        symbol: "USDST",
        address: v.asset,
        balanceRaw: v.debtAmount || "0",
        decimals: 18,
        valueUsd: -debt,
        healthFactor: v.healthFactor ?? null,
        href: "/dashboard/vault",
        investedUsd: null,
        unrealizedUsd: null,
        unrealizedPct: null,
        groupKey: deriveUnderlying({ address: v.asset, symbol: v.symbol }),
      });
    }

    // ----- Liability: lending pool borrow position (USDST) -----
    let owed = 0;
    try {
      owed = loans?.totalAmountOwed
        ? parseFloat(formatUnits(BigInt(loans.totalAmountOwed), 18))
        : 0;
    } catch {
      owed = 0;
    }
    if (owed > 0) {
      positions.push({
        id: "loan:lending",
        kind: "loan",
        label: "USDST Loan",
        symbol: "USDST",
        balanceRaw: loans?.totalAmountOwed || "0",
        decimals: 18,
        valueUsd: -owed,
        healthFactor: loans?.healthFactor ?? null,
        href: "/dashboard/borrow",
        investedUsd: null,
        unrealizedUsd: null,
        unrealizedPct: null,
        groupKey: "USDST",
      });
    }

    const groups = buildGroups(positions);

    const totalGrossUsd = groups.reduce((s, g) => s + g.grossValueUsd, 0);
    const computedDebt = groups.reduce((s, g) => s + g.debtUsd, 0);

    let totalInvested = 0;
    let totalUnrealized = 0;
    let hasPnl = false;
    for (const g of groups) {
      if (g.investedUsd != null || g.unrealizedUsd != null) {
        hasPnl = true;
        totalInvested += g.investedUsd ?? 0;
        totalUnrealized += g.unrealizedUsd ?? 0;
      }
    }

    return {
      // When logged in, prefer the server net balance as the authoritative
      // headline (netBalance = totalAssetValue − totalBorrowed).
      totalValueUsd: isLoggedIn ? netBalance : totalGrossUsd - computedDebt,
      totalGrossUsd,
      totalDebtUsd: isLoggedIn && totalBorrowed > 0 ? totalBorrowed : computedDebt,
      groups,
      isLoading: loadingEarningAssets || loadingNetBalance,
      totalInvestedUsd: hasPnl ? totalInvested : null,
      totalUnrealizedUsd: hasPnl ? totalUnrealized : null,
      totalUnrealizedPct:
        hasPnl && totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : null,
    };
  }, [
    earningAssets,
    vaults,
    loans,
    flows,
    netBalance,
    totalBorrowed,
    isLoggedIn,
    loadingEarningAssets,
    loadingNetBalance,
  ]);
};
