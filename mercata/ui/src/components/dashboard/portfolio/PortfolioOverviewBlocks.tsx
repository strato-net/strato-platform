import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Gift, Sparkles, TrendingUp } from "lucide-react";
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
import type { PortfolioEarningRow, PortfolioYieldRollup } from "@/hooks/usePortfolioEarningRows";
import type { BalanceSnapshot } from "@mercata/shared-types";

const CATA_PRICE_USD = 0.25;

const ACTIVITY_SNIPPET_KEYS = [
  "Deposit",
  "Withdraw",
  "AddLiquidity",
  "RewardsClaimed",
  "Borrow",
  "Swap",
  "VaultDeposited",
] as const;

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
    "rounded-xl border border-border bg-card p-4 shadow-sm flex flex-col gap-1 min-h-[100px]";

  if (!isLoggedIn) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
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
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
      <div className={colClass}>
        <p className="text-xs font-medium text-muted-foreground">Portfolio value</p>
        {portfolioLoading ? (
          <Skeleton className="h-7 w-36 mt-0.5" />
        ) : (
          <>
            <p className="text-lg md:text-xl font-bold tabular-nums">
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
      </div>

      <div className={colClass}>
        <p className="text-xs font-medium text-muted-foreground">Est. annual earnings</p>
        {earningMetricsLoading ? (
          <>
            <Skeleton className="h-7 w-32 mt-0.5" />
            <Skeleton className="h-4 w-24 mt-1" />
          </>
        ) : (
          <>
            <p className="text-lg md:text-xl font-bold tabular-nums">
              ${estAnnualUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs font-normal text-muted-foreground"> / yr</span>
            </p>
            <p className="text-xs text-muted-foreground">
              ~${(estAnnualUsd / 365).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / day
            </p>
          </>
        )}
      </div>

      <div className={colClass}>
        <p className="text-xs font-medium text-muted-foreground">Blended est. APY</p>
        {earningMetricsLoading ? (
          <Skeleton className="h-7 w-20 mt-0.5" />
        ) : (
          <p className="text-lg md:text-xl font-bold tabular-nums">
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
      </div>

      <div className={colClass}>
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
            <p className="text-lg md:text-xl font-bold tabular-nums leading-snug">
              {claimableRewardsDisplay}
            </p>
            <p className="text-xs text-muted-foreground">~${claimableUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function PortfolioPerformanceBlock({
  activeTab,
  setActiveTab,
  chartConfig,
  selectedTimeRange,
  onTimeRangeChange,
  loadingBalanceHistory,
  isLoggedIn,
  rewardsEnabled,
}: {
  activeTab: "netBalance" | "rewards" | "earnings";
  setActiveTab: (t: "netBalance" | "rewards" | "earnings") => void;
  chartConfig: {
    netBalance: { data: BalanceSnapshot[]; title: string; subtitle: string; currentValue: number };
    rewards: { data: BalanceSnapshot[]; title: string; subtitle: string; currentValue: number };
    earnings: { data: BalanceSnapshot[]; title: string; subtitle: string; currentValue: number };
  };
  selectedTimeRange: string;
  onTimeRangeChange: (d: string) => void;
  loadingBalanceHistory: boolean;
  isLoggedIn: boolean;
  rewardsEnabled: boolean;
}) {
  if (!isLoggedIn) return null;

  const effectiveTab = activeTab === "rewards" && !rewardsEnabled ? "netBalance" : activeTab;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold mb-3">Performance</h2>
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 mb-3">
        <Select
          value={effectiveTab}
          onValueChange={(v) => setActiveTab(v as "netBalance" | "rewards" | "earnings")}
        >
          <SelectTrigger className="w-full sm:w-[220px] h-9" aria-label="Chart metric">
            <SelectValue placeholder="Metric" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="netBalance">Portfolio</SelectItem>
            {rewardsEnabled && <SelectItem value="rewards">Rewards</SelectItem>}
            <SelectItem value="earnings">Earnings</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="w-full min-w-0">
        <PortfolioValueChart
          data={chartConfig[effectiveTab].data || []}
          onTimeRangeChange={onTimeRangeChange}
          selectedTimeRange={selectedTimeRange}
          isLoading={loadingBalanceHistory}
          tabType={effectiveTab === "earnings" ? "earnings" : effectiveTab}
          title={chartConfig[effectiveTab].title}
          subtitle={chartConfig[effectiveTab].subtitle}
          currentValue={chartConfig[effectiveTab].currentValue}
        />
      </div>
    </div>
  );
}

export function PortfolioInsightsRow({
  isLoggedIn,
  rewardsEnabled,
  claimableRewardsWei,
  bestRow,
  blendedApy,
  estAnnualUsd,
  onNavigateClaim,
  earningMetricsLoading,
  rewardsClaimableLoading,
  portfolioYieldRollup,
}: {
  isLoggedIn: boolean;
  rewardsEnabled: boolean;
  claimableRewardsWei: string;
  bestRow: PortfolioEarningRow | null;
  blendedApy: number | null;
  estAnnualUsd: number;
  onNavigateClaim: () => void;
  earningMetricsLoading: boolean;
  rewardsClaimableLoading: boolean;
  portfolioYieldRollup: PortfolioYieldRollup | null;
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            Suggested next steps
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {hasClaimable && (
            <button
              type="button"
              className="w-full text-left rounded-lg border border-border bg-muted/30 hover:bg-muted/50 p-3 flex items-start justify-between gap-2"
              onClick={onNavigateClaim}
            >
              <span>
                <span className="font-medium">Claim reward points</span>
                <span className="block text-muted-foreground text-xs mt-0.5">You have claimable STRATO rewards</span>
              </span>
              <Gift className="w-4 h-4 shrink-0 text-purple-500" />
            </button>
          )}
          {bestRow && bestRow.apyTotal != null && (
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="font-medium">Highest estimated APY</p>
              <p className="text-muted-foreground text-xs mt-1">
                {bestRow.asset._symbol || bestRow.asset._name} at {bestRow.apyTotal.toFixed(2)}% (indicative)
              </p>
              <Button variant="link" className="h-auto p-0 mt-2" asChild>
                <Link to={bestRow.href}>Open position</Link>
              </Button>
            </div>
          )}
          {!hasClaimable && !bestRow && (
            <p className="text-muted-foreground text-sm">Deposit or add liquidity to see suggestions here.</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Yield summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between gap-4 items-center">
            <span className="text-muted-foreground">Native (est.)</span>
            {earningMetricsLoading ? (
              <Skeleton className="h-5 w-14 shrink-0" />
            ) : (
              <span className="font-semibold tabular-nums">
                {portfolioYieldRollup != null ? `${portfolioYieldRollup.nativeApy.toFixed(2)}%` : "—"}
              </span>
            )}
          </div>
          <div className="flex justify-between gap-4 items-center">
            <span className="text-muted-foreground">Base (est.)</span>
            {earningMetricsLoading ? (
              <Skeleton className="h-5 w-14 shrink-0" />
            ) : (
              <span className="font-semibold tabular-nums">
                {portfolioYieldRollup != null ? `${portfolioYieldRollup.baseApy.toFixed(2)}%` : "—"}
              </span>
            )}
          </div>
          <div className="flex justify-between gap-4 items-center">
            <span className="text-muted-foreground">STRATO rewards (est.)</span>
            {earningMetricsLoading ? (
              <Skeleton className="h-5 w-14 shrink-0" />
            ) : (
              <span className="font-semibold tabular-nums">
                {portfolioYieldRollup != null ? `${portfolioYieldRollup.rewardsApy.toFixed(2)}%` : "—"}
              </span>
            )}
          </div>
          <div className="flex justify-between gap-4 items-center">
            <span className="text-muted-foreground">Total est. yield (blended)</span>
            {earningMetricsLoading ? (
              <Skeleton className="h-5 w-16 shrink-0" />
            ) : (
              <span className="font-semibold tabular-nums">{blendedApy != null ? `${blendedApy.toFixed(2)}%` : "—"}</span>
            )}
          </div>
          <div className="flex justify-between gap-4 items-center">
            <span className="text-muted-foreground">Est. annual earnings</span>
            {earningMetricsLoading ? (
              <Skeleton className="h-5 w-28 shrink-0" />
            ) : (
              <span className="font-semibold tabular-nums">
                ${estAnnualUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / yr
              </span>
            )}
          </div>
          {!earningMetricsLoading && portfolioYieldRollup != null && estAnnualUsd > 0 && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              ~$
              {portfolioYieldRollup.estNativeUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
              native · ~$
              {portfolioYieldRollup.estBaseUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
              base · ~$
              {portfolioYieldRollup.estRewardsUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
              rewards / yr
            </p>
          )}
          <p className="text-xs text-muted-foreground pt-1 border-t border-border">
            Figures use live APY hints from Earn and your position values; they are indicative, not guarantees.
          </p>
        </CardContent>
      </Card>
    </div>
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
