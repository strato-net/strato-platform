import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import PortfolioValueChart from "@/components/dashboard/PortfolioValueChart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { activityFeedApi } from "@/lib/activityFeed";
import { activityTypes } from "@/components/dashboard/activityTypes";
import type { Event } from "@mercata/shared-types";
import { formatUnits } from "viem";
import { formatBalance } from "@/utils/numberUtils";
import type { CollateralData, NewLoanData } from "@/interface";
import type { Token as WalletToken } from "@mercata/shared-types";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getPortfolioAssetHref } from "@/utils/portfolioAssetRoutes";
import type { PortfolioYieldRollup } from "@/hooks/usePortfolioEarningRows";
import type { IdleHoldingRow } from "@/hooks/usePortfolioIdleHoldings";
import type { BalanceSnapshot } from "@mercata/shared-types";
import { cn } from "@/lib/utils";

const CATA_PRICE_USD = 0.25;

/** KPI tile → Performance chart (same order as the strip). */
export type PortfolioChartKpi = "portfolio" | "estAnnual" | "blendedApy" | "rewards";

export type PerformanceChartSlice = {
  data: BalanceSnapshot[];
  title: string;
  subtitle: string;
  currentValue: number;
  tabType: "netBalance" | "rewards" | "earnings" | "estAnnual";
  showReferenceLine?: boolean;
};

const ACTIVITY_SNIPPET_KEYS = [
  "Deposit",
  "Withdraw",
  "AddLiquidity",
  "RewardsClaimed",
  "Borrow",
  "Swap",
  "VaultDeposited",
] as const;

function KpiTile({
  selected,
  selectable,
  kpi,
  onSelect,
  children,
}: {
  selected: boolean;
  selectable: boolean;
  kpi: PortfolioChartKpi;
  onSelect?: (k: PortfolioChartKpi) => void;
  children: ReactNode;
}) {
  const base =
    "rounded-xl border border-border bg-card p-3 md:p-4 shadow-sm flex flex-col gap-1 min-h-[88px] md:min-h-[100px] w-full min-w-0";
  const state = cn(
    selected && selectable && "ring-2 ring-primary border-primary",
    selectable && "cursor-pointer transition-colors hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  );

  if (selectable && onSelect) {
    return (
      <button
        type="button"
        className={cn(base, state, "text-left")}
        onClick={() => onSelect(kpi)}
        aria-pressed={selected}
      >
        {children}
      </button>
    );
  }

  return <div className={base}>{children}</div>;
}

export function PortfolioKpiStrip({
  isLoggedIn,
  portfolioValueUsd,
  portfolioLoading,
  change1mLabel,
  estAnnualUsd,
  blendedApy,
  claimableRewardsDisplay,
  claimableRewardsWei,
  rewardsEnabled,
  earningMetricsLoading,
  rewardsClaimableLoading,
  portfolioYieldRollup,
  selectedChartKpi,
  onSelectChartKpi,
}: {
  isLoggedIn: boolean;
  portfolioValueUsd: number;
  portfolioLoading: boolean;
  change1mLabel: string | null;
  estAnnualUsd: number;
  blendedApy: number | null;
  /** Same formatting as Rewards “Total claimable”. */
  claimableRewardsDisplay: string;
  /** Total claimable in wei (unclaimed + real-time pending), decimal string. */
  claimableRewardsWei: string;
  rewardsEnabled: boolean;
  earningMetricsLoading: boolean;
  rewardsClaimableLoading: boolean;
  /** Value-weighted Native / Base / STRATO rewards APY (matches blended total). */
  portfolioYieldRollup: PortfolioYieldRollup | null;
  /** When set with `onSelectChartKpi`, tiles drive the Performance chart. */
  selectedChartKpi?: PortfolioChartKpi;
  onSelectChartKpi?: (k: PortfolioChartKpi) => void;
}) {
  const claimableUsdNum = useMemo(() => {
    try {
      return Number(formatUnits(BigInt(claimableRewardsWei || "0"), 18));
    } catch {
      return 0;
    }
  }, [claimableRewardsWei]);
  const claimableUsd = claimableUsdNum * CATA_PRICE_USD;

  const colClass =
    "rounded-xl border border-border bg-card p-3 md:p-4 shadow-sm flex flex-col gap-1 min-h-[88px] md:min-h-[100px] min-w-0";

  const chartDrive = Boolean(onSelectChartKpi && selectedChartKpi != null);

  if (!isLoggedIn) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4 mb-6 min-w-0">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={colClass}>
            <p className="text-xs text-muted-foreground">—</p>
            <p className="text-lg font-bold">—</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4 mb-6 min-w-0">
      <KpiTile
        kpi="portfolio"
        selectable={chartDrive}
        selected={chartDrive && selectedChartKpi === "portfolio"}
        onSelect={onSelectChartKpi}
      >
        <p className="text-xs font-medium text-muted-foreground">Portfolio value</p>
        {portfolioLoading ? (
          <Skeleton className="h-7 w-36 mt-0.5" />
        ) : (
          <>
            <p
              className="text-sm sm:text-base md:text-lg lg:text-xl font-bold tabular-nums min-w-0 break-words leading-tight"
              title={`$${portfolioValueUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            >
              ${portfolioValueUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            {change1mLabel && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                {change1mLabel} <span className="text-muted-foreground">~1M</span>
              </p>
            )}
          </>
        )}
      </KpiTile>

      <KpiTile
        kpi="estAnnual"
        selectable={chartDrive}
        selected={chartDrive && selectedChartKpi === "estAnnual"}
        onSelect={onSelectChartKpi}
      >
        <p className="text-xs font-medium text-muted-foreground">Est. annual earnings</p>
        {earningMetricsLoading ? (
          <>
            <Skeleton className="h-7 w-32 mt-0.5" />
            <Skeleton className="h-4 w-24 mt-1" />
          </>
        ) : (
          <>
            <p
              className="text-sm sm:text-base md:text-lg lg:text-xl font-bold tabular-nums min-w-0 break-words leading-tight"
              title={`$${estAnnualUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / yr`}
            >
              ${estAnnualUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-[10px] sm:text-xs font-normal text-muted-foreground"> / yr</span>
            </p>
            <p className="text-[10px] sm:text-xs text-muted-foreground min-w-0 break-words">
              ~${(estAnnualUsd / 365).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / day
            </p>
          </>
        )}
      </KpiTile>

      <KpiTile
        kpi="blendedApy"
        selectable={chartDrive}
        selected={chartDrive && selectedChartKpi === "blendedApy"}
        onSelect={onSelectChartKpi}
      >
        <p className="text-xs font-medium text-muted-foreground">Blended est. APY</p>
        {earningMetricsLoading ? (
          <Skeleton className="h-7 w-20 mt-0.5" />
        ) : (
          <p className="text-sm sm:text-base md:text-lg lg:text-xl font-bold tabular-nums min-w-0">
            {blendedApy != null ? `${blendedApy.toFixed(2)}%` : "—"}
          </p>
        )}
        {!earningMetricsLoading && blendedApy != null && portfolioYieldRollup ? (
          <p className="text-[11px] sm:text-xs text-muted-foreground leading-snug">
            Native {portfolioYieldRollup.nativeApy.toFixed(2)}% · Base {portfolioYieldRollup.baseApy.toFixed(2)}% · STRATO rewards{" "}
            {portfolioYieldRollup.rewardsApy.toFixed(2)}%
          </p>
        ) : !earningMetricsLoading ? (
          <p className="text-xs text-muted-foreground">By position value</p>
        ) : null}
      </KpiTile>

      <KpiTile
        kpi="rewards"
        selectable={chartDrive && rewardsEnabled}
        selected={chartDrive && selectedChartKpi === "rewards"}
        onSelect={rewardsEnabled ? onSelectChartKpi : undefined}
      >
        <p className="text-xs font-medium text-muted-foreground">Claimable rewards</p>
        {!rewardsEnabled ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : rewardsClaimableLoading ? (
          <>
            <Skeleton className="h-7 w-28 mt-0.5" />
            <Skeleton className="h-4 w-20 mt-1" />
          </>
        ) : (
          <>
            <p className="text-sm sm:text-base md:text-lg lg:text-xl font-bold tabular-nums leading-snug min-w-0 break-words">
              {claimableRewardsDisplay}
            </p>
            <p className="text-[10px] sm:text-xs text-muted-foreground min-w-0 break-words">
              ~${claimableUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </p>
          </>
        )}
      </KpiTile>
    </div>
  );
}

export function PortfolioPerformanceBlock({
  chart,
  selectedTimeRange,
  onTimeRangeChange,
  loadingBalanceHistory,
  isLoggedIn,
}: {
  chart: PerformanceChartSlice;
  selectedTimeRange: string;
  onTimeRangeChange: (d: string) => void;
  loadingBalanceHistory: boolean;
  isLoggedIn: boolean;
}) {
  if (!isLoggedIn) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold mb-3">Performance</h2>
      <div className="w-full min-w-0">
        <PortfolioValueChart
          data={chart.data || []}
          onTimeRangeChange={onTimeRangeChange}
          selectedTimeRange={selectedTimeRange}
          isLoading={loadingBalanceHistory}
          tabType={chart.tabType}
          title={chart.title}
          subtitle={chart.subtitle}
          currentValue={chart.currentValue}
          showReferenceLine={chart.showReferenceLine !== false}
        />
      </div>
    </div>
  );
}

export type TopEarnDisplay = {
  title: string;
  apy: number | null;
  path: string;
};

export function PortfolioInsightsRow({
  isLoggedIn,
  rewardsEnabled,
  claimableRewardsWei,
  claimableRewardsDisplay,
  blendedApy,
  onNavigateClaim,
  earningMetricsLoading,
  rewardsClaimableLoading,
  portfolioYieldRollup,
  idleTop,
  easySavingsApyPct,
  topEarnDisplay,
  recommendedLoading,
}: {
  isLoggedIn: boolean;
  rewardsEnabled: boolean;
  claimableRewardsWei: string;
  claimableRewardsDisplay: string;
  blendedApy: number | null;
  onNavigateClaim: () => void;
  earningMetricsLoading: boolean;
  rewardsClaimableLoading: boolean;
  portfolioYieldRollup: PortfolioYieldRollup | null;
  idleTop: { usd: number; symbol: string } | null;
  easySavingsApyPct: number | null;
  topEarnDisplay: TopEarnDisplay | null;
  recommendedLoading: boolean;
}) {
  if (!isLoggedIn) return null;

  const hasClaimable =
    rewardsEnabled &&
    !rewardsClaimableLoading &&
    (() => {
      try {
        return BigInt(claimableRewardsWei || "0") > 0n;
      } catch {
        return false;
      }
    })();

  const stratoRewardsPct = portfolioYieldRollup?.rewardsApy ?? null;

  const rowClass =
    "grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 items-start md:items-center py-3 px-3 md:px-4 border-b border-border last:border-b-0 text-sm";

  return (
    <Card className="border-border shadow-sm mb-8">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-bold">Recommended actions</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="rounded-lg border border-border overflow-hidden bg-card">
          <div className={rowClass}>
            <div className="min-w-0">
              <span className="font-semibold text-muted-foreground mr-1.5">1.</span>
              {idleTop ? (
                <span className="text-foreground">
                  ${idleTop.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                  {idleTop.symbol} is idle.{" "}
                  <Link
                    to="/dashboard/earn-save"
                    className="font-medium text-blue-600 hover:text-blue-800 underline underline-offset-2"
                  >
                    Move to Easy Savings
                  </Link>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  No idle wallet balance over $10 with a price. Explore{" "}
                  <Link to="/dashboard/earn-save" className="text-blue-600 hover:underline">
                    Easy Savings
                  </Link>
                  .
                </span>
              )}
            </div>
            <div className="md:text-right tabular-nums shrink-0">
              {recommendedLoading ? (
                <Skeleton className="h-5 w-24 ml-auto" />
              ) : (
                <span className="font-semibold">
                  Base Yield: {easySavingsApyPct != null ? `${easySavingsApyPct.toFixed(2)}%` : "—"}
                </span>
              )}
            </div>
          </div>

          <div className={rowClass}>
            <div className="min-w-0">
              <span className="font-semibold text-muted-foreground mr-1.5">2.</span>
              {rewardsEnabled && hasClaimable ? (
                <button
                  type="button"
                  className="text-left font-medium text-foreground hover:underline underline-offset-2"
                  onClick={onNavigateClaim}
                >
                  Claim {claimableRewardsDisplay || "reward points"} rewards
                </button>
              ) : rewardsEnabled ? (
                <span className="text-muted-foreground">No claimable rewards right now.</span>
              ) : (
                <span className="text-muted-foreground">Rewards are not enabled on this network.</span>
              )}
            </div>
            <div className="md:text-right tabular-nums shrink-0">
              {earningMetricsLoading ? (
                <Skeleton className="h-5 w-24 ml-auto" />
              ) : (
                <span className="font-semibold">
                  STRATO Rewards: {stratoRewardsPct != null ? `${stratoRewardsPct.toFixed(2)}%` : "—"}
                </span>
              )}
            </div>
          </div>

          <div className={rowClass}>
            <div className="min-w-0">
              <span className="font-semibold text-muted-foreground mr-1.5">3.</span>
              {recommendedLoading ? (
                <Skeleton className="h-4 w-64 max-w-full" />
              ) : topEarnDisplay && topEarnDisplay.apy != null && Number.isFinite(topEarnDisplay.apy) ? (
                <span className="text-foreground">
                  Highest yield:{" "}
                  <Link
                    to={topEarnDisplay.path}
                    className="font-medium text-blue-600 hover:text-blue-800 underline underline-offset-2"
                  >
                    {topEarnDisplay.title}
                  </Link>{" "}
                  at {topEarnDisplay.apy.toFixed(2)}% est. APY
                </span>
              ) : topEarnDisplay ? (
                <span className="text-foreground">
                  Top opportunity:{" "}
                  <Link
                    to={topEarnDisplay.path}
                    className="font-medium text-blue-600 hover:text-blue-800 underline underline-offset-2"
                  >
                    {topEarnDisplay.title}
                  </Link>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  <Link to="/dashboard/earn" className="text-blue-600 hover:underline">
                    Browse Earn
                  </Link>{" "}
                  for pools and vaults.
                </span>
              )}
            </div>
            <div className="md:text-right tabular-nums shrink-0">
              {earningMetricsLoading ? (
                <Skeleton className="h-5 w-24 ml-auto" />
              ) : (
                <span className="font-semibold">
                  Total Est. Yield: {blendedApy != null ? `${blendedApy.toFixed(2)}%` : "—"}
                </span>
              )}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed mt-3">
          Row 1 uses Easy Savings APY; row 3 uses the same top-opportunity ranking as the Earn page. Portfolio
          percentages are indicative.
        </p>
      </CardContent>
    </Card>
  );
}

export function PortfolioBorrowingOverview({
  guestMode,
  loanData,
  collateralRows,
  loading,
}: {
  guestMode: boolean;
  loanData?: NewLoanData;
  collateralRows: CollateralData[];
  loading: boolean;
}) {
  const borrowed = useMemo(() => {
    if (!loanData?.totalAmountOwed) return 0;
    try {
      const v = BigInt(loanData.totalAmountOwed);
      if (v <= 1n) return 0;
      return parseFloat(formatUnits(v, 18));
    } catch {
      return 0;
    }
  }, [loanData?.totalAmountOwed]);

  const collateralSummary = useMemo(() => {
    const active = collateralRows.filter((c) => {
      try {
        return BigInt(c.collateralizedAmount || "0") > 0n;
      } catch {
        return false;
      }
    });
    if (active.length === 0) return "—";
    const labels = active.slice(0, 3).map((c) => c._symbol || c.symbol || "Asset");
    return labels.join(", ") + (active.length > 3 ? "…" : "");
  }, [collateralRows]);

  const netCarryLabel = useMemo(() => {
    if (borrowed <= 0 || loanData?.interestRate == null) return null;
    const pct = loanData.interestRate / 100;
    return `-${pct.toFixed(1)}% borrow cost`;
  }, [borrowed, loanData?.interestRate]);

  if (guestMode) {
    return (
      <Card className="mb-8 border-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Borrowed / collateral</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Sign in to view borrowing.</CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-8 border-border shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-lg">Borrowed / collateral</CardTitle>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/borrow">Manage</Link>
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="py-2 pr-4">Position</th>
              <th className="py-2 pr-4 text-right">Borrowed</th>
              <th className="py-2 pr-4">Collateral</th>
              <th className="py-2 pr-4">Net carry</th>
              <th className="py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/60">
              <td className="py-3 pr-4 font-medium">{loanData?.assetSymbol || "USDST"} borrow</td>
              <td className="py-3 pr-4 text-right tabular-nums">
                {loading ? (
                  <Skeleton className="h-5 w-24 ml-auto" />
                ) : borrowed > 0 ? (
                  `${borrowed.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDST`
                ) : (
                  "—"
                )}
              </td>
              <td className="py-3 pr-4 text-muted-foreground">
                {loading ? <Skeleton className="h-5 w-40" /> : collateralSummary}
              </td>
              <td className="py-3 pr-4 text-muted-foreground tabular-nums">
                {loading ? (
                  <Skeleton className="h-5 w-36" />
                ) : netCarryLabel ? (
                  netCarryLabel
                ) : (
                  "—"
                )}
              </td>
              <td className="py-3 text-right">
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/dashboard/borrow" className="gap-1">
                    Manage <ArrowRight className="w-3 h-3" />
                  </Link>
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function PortfolioRecentActivity({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [lines, setLines] = useState<{ title: string; sub: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) {
      setLines([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const pairs = ACTIVITY_SNIPPET_KEYS.map((k) => {
          const c = activityTypes[k];
          return {
            contract_name: c.contract_name,
            event_name: c.event_name,
            filterConfig: c.filterConfig,
          };
        });
        const res = await activityFeedApi.getActivities(pairs, {
          limit: 6,
          offset: 0,
          myActivity: true,
          timeRange: "month",
        });
        if (cancelled) return;
        const events = (res.events || []) as Event[];
        const out: { title: string; sub: string }[] = [];
        for (const ev of events) {
          const match = Object.entries(activityTypes).find(
            ([, cfg]) => cfg.contract_name === ev.contract_name && cfg.event_name === ev.event_name
          );
          const label = match?.[1]?.displayName || ev.event_name || "Activity";
          const ts = ev.block_timestamp ? new Date(ev.block_timestamp) : null;
          const sub = ts && !isNaN(ts.getTime()) ? formatDistanceToNow(ts, { addSuffix: true }) : "";
          out.push({ title: label, sub });
        }
        setLines(out);
      } catch {
        if (!cancelled) setLines([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  if (!isLoggedIn) return null;

  return (
    <Card className="mb-8 border-border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">Recent activity</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard/activity">View all</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activity this month.</p>
        ) : (
          <ul className="space-y-3">
            {lines.map((l, i) => (
              <li key={i} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-sm border-b border-border/50 last:border-0 pb-2 last:pb-0">
                <span className="font-medium">{l.title}</span>
                <span className="text-xs text-muted-foreground sm:text-sm">{l.sub}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function PortfolioNonEarningAssets({
  tokens,
  loading,
}: {
  tokens: WalletToken[];
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (tokens.length === 0 && !loading) return null;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm mb-8 overflow-hidden">
      <button
        type="button"
        className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-bold text-lg">Other wallet tokens</span>
        {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${open ? "max-h-[480px] opacity-100" : "max-h-0 opacity-0"}`}
      >
        <div className="overflow-y-auto max-h-[440px] px-4 pb-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-primary" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2">Asset</th>
                  <th className="py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tokens.map((asset, index) => (
                  <tr key={asset.address || index}>
                    <td className="py-2">
                      <Link
                        to={getPortfolioAssetHref(asset)}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {asset._symbol || asset._name}
                      </Link>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {!asset?.balance || asset.balance === "0"
                        ? "—"
                        : formatBalance(asset.balance, undefined, 18, 1, 4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const idleValueFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function PortfolioIdleHoldings({
  rows,
  loading,
  guestMode,
}: {
  rows: IdleHoldingRow[];
  loading: boolean;
  guestMode: boolean;
}) {
  const [open, setOpen] = useState(true);

  if (guestMode) return null;
  if (!loading && rows.length === 0) return null;

  const count = rows.length;
  const countPending = loading && count === 0;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm mb-8 overflow-hidden">
      <button
        type="button"
        className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors gap-2"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-bold text-lg shrink-0">Idle Holdings</span>
        <div className="flex items-center gap-2 min-w-0 justify-end">
          <span className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">
            {countPending ? (
              "Loading…"
            ) : open ? (
              <>
                Hide <span className="font-medium text-foreground">{count}</span>
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">{count}</span> idle
              </>
            )}
          </span>
          {open ? <ChevronUp size={20} className="shrink-0" /> : <ChevronDown size={20} className="shrink-0" />}
        </div>
      </button>
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${open ? "max-h-[560px] opacity-100" : "max-h-0 opacity-0"}`}
      >
        <div className="overflow-x-auto overflow-y-auto max-h-[520px] px-4 pb-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-primary" />
            </div>
          ) : (
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4">Asset</th>
                  <th className="py-2 pr-4 text-right">Value</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Opportunity</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.address}>
                    <td className="py-3 pr-4 font-medium">
                      <Link
                        to={getPortfolioAssetHref({ address: row.address, _symbol: row.symbol })}
                        className="text-blue-600 hover:underline"
                      >
                        {row.symbol}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">{idleValueFormatter.format(row.valueUsd)}</td>
                    <td className="py-3 pr-4 text-muted-foreground">Idle</td>
                    <td className="py-3 pr-4 text-muted-foreground">{row.opportunity}</td>
                    <td className="py-3 text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={row.to} className="gap-1">
                          {row.actionLabel} <ArrowRight className="w-3 h-3" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
