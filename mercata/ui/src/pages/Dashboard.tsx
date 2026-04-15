import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import DashboardFAQ from "../components/dashboard/DashboardFAQ";
import { Send, Book, ArrowRightLeft, Gem, Mail } from "lucide-react";
import { useTokenContext } from "@/context/TokenContext";
import { useUser } from "@/context/UserContext";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useNetBalance } from "@/hooks/useNetBalance";
import { useLendingContext } from "@/context/LendingContext";
import { useCDP } from "@/context/CDPContext";
import { cataAddress, rewardsEnabled } from "@/lib/constants";
import { BalanceSnapshot } from "@mercata/shared-types";
import { Button } from "@/components/ui/button";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import LiquidationAlertBanner from "@/components/ui/LiquidationAlertBanner";
import ContactInquiryModal from "@/components/contact/ContactInquiryModal";
import { useNetwork } from "@/context/NetworkContext";
import { useEarnContext } from "@/context/EarnContext";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import {
  computeTotalClaimableRewards,
  formatTotalClaimablePointsDisplay,
} from "@/services/rewardsService";
import { usePortfolioEarningRows } from "@/hooks/usePortfolioEarningRows";
import { usePortfolioRecommendedActionsData } from "@/hooks/usePortfolioRecommendedActionsData";
import { usePortfolioIdleHoldings } from "@/hooks/usePortfolioIdleHoldings";
import PortfolioPositionsTable from "@/components/dashboard/portfolio/PortfolioPositionsTable";
import {
  PortfolioBorrowingOverview,
  PortfolioInsightsRow,
  PortfolioKpiStrip,
  PortfolioNonEarningAssets,
  PortfolioIdleHoldings,
  PortfolioPerformanceBlock,
  PortfolioRecentActivity,
  type PortfolioChartKpi,
  type PerformanceChartSlice,
} from "@/components/dashboard/portfolio/PortfolioOverviewBlocks";

const TIME_RANGES = ["1d", "7d", "1m", "3m", "6m", "1y", "all"] as const;
type TimeRange = (typeof TIME_RANGES)[number];

function portfolioValuePct1m(snapshots: BalanceSnapshot[]): string | null {
  if (!snapshots?.length || snapshots.length < 2) return null;
  const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);
  const first = Number(sorted[0].balance);
  const last = Number(sorted[sorted.length - 1].balance);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  const pct = ((last - first) / first) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

const Dashboard = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { userAddress, isLoggedIn } = useUser();
  const {
    earningAssets,
    getEarningAssets,
    inactiveTokens,
    getInactiveTokens,
    getBalanceHistory,
    getCataBalanceHistory,
    loadingEarningAssets,
    loadingInactiveTokens,
    netBalanceHistoryCache,
    rewardsHistoryCache,
    loadingBalanceHistory,
    setNetBalanceHistoryCache,
    setRewardsHistoryCache,
    setLoadingBalanceHistory,
  } = useTokenContext();

  const [chartKpi, setChartKpi] = useState<PortfolioChartKpi>(() => {
    const k = localStorage.getItem("dashboard-chartKpi");
    if (k === "portfolio" || k === "estAnnual" || k === "blendedApy" || k === "rewards") {
      return k;
    }
    const legacy = localStorage.getItem("dashboard-activeTab");
    if (legacy === "rewards") return "rewards";
    if (legacy === "earnings") return "estAnnual";
    return "portfolio";
  });

  const { loans, refreshLoans, collateralInfo, loadingLoans, loadingCollateral } = useLendingContext();
  const { refreshVaults } = useCDP();
  const { contactEnabled } = useNetwork();
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>(() => {
    const stored = localStorage.getItem("dashboard-timeRange");
    if (stored && TIME_RANGES.includes(stored as TimeRange)) {
      return stored as TimeRange;
    }
    return "1m";
  });

  const { userRewards, loading: rewardsUserLoading } = useRewardsUserInfo();
  const { tokenApysLoaded } = useEarnContext();

  const cataToken = useMemo(
    () => inactiveTokens?.find((token) => token.address === cataAddress),
    [inactiveTokens]
  );

  const { netBalance: totalBalance, cataBalance, isLoading: isLoadingNetBalance } = useNetBalance({
    cataToken,
  });

  const {
    rows: positionRows,
    blendedApy,
    totalEstAnnualUsd,
    totalEarningValueUsd,
    portfolioYieldRollup,
  } = usePortfolioEarningRows(earningAssets);

  const {
    idleTop,
    easySavingsApyPct,
    topEarnDisplay,
    loading: recommendedActionsLoading,
  } = usePortfolioRecommendedActionsData(isLoggedIn);

  const { rows: idleHoldingRows, loading: idleHoldingsLoading } = usePortfolioIdleHoldings(isLoggedIn);

  const earningMetricsLoading = loadingEarningAssets || (!!earningAssets.length && !tokenApysLoaded);
  const rewardsClaimableLoading = isLoggedIn && rewardsEnabled && rewardsUserLoading;
  const borrowingOverviewLoading = isLoggedIn && (loadingLoans || loadingCollateral);

  useEffect(() => {
    if (!isLoggedIn) return;
    if (netBalanceHistoryCache["1m"]?.length) return;
    let cancelled = false;
    getBalanceHistory("1m", "")
      .then((data) => {
        if (!cancelled && data?.length) setNetBalanceHistoryCache("1m", data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, userAddress, getBalanceHistory, setNetBalanceHistoryCache, netBalanceHistoryCache]);

  const change1mLabel = useMemo(
    () => portfolioValuePct1m(netBalanceHistoryCache["1m"] || []),
    [netBalanceHistoryCache]
  );

  const chartConfig = useMemo(() => {
    const netSeries = netBalanceHistoryCache[selectedTimeRange] || [];
    const earningRatio =
      totalBalance > 0 && Number.isFinite(totalBalance)
        ? Math.min(1, Math.max(0, totalEarningValueUsd / totalBalance))
        : 0;
    const earningsData: BalanceSnapshot[] = netSeries.map((s) => ({
      timestamp: s.timestamp,
      balance: (typeof s.balance === "number" ? s.balance : Number(s.balance)) * earningRatio,
    }));

    return {
      netBalance: {
        data: netSeries,
        title: "Portfolio value",
        subtitle: "Net balance over time",
        currentValue: totalBalance,
      },
      rewards: {
        data: rewardsHistoryCache[selectedTimeRange] || [],
        title: "Rewards",
        subtitle: "Reward points over time",
        currentValue: cataBalance,
      },
      earnings: {
        data: earningsData,
        title: "Earnings",
        subtitle: "Estimated from portfolio history and current earning allocation",
        currentValue: totalEarningValueUsd,
      },
    };
  }, [
    netBalanceHistoryCache,
    rewardsHistoryCache,
    selectedTimeRange,
    totalBalance,
    cataBalance,
    totalEarningValueUsd,
  ]);

  const performanceChart = useMemo((): PerformanceChartSlice => {
    const c = chartConfig;
    switch (chartKpi) {
      case "portfolio":
        return {
          data: c.netBalance.data,
          title: c.netBalance.title,
          subtitle: c.netBalance.subtitle,
          currentValue: c.netBalance.currentValue,
          tabType: "netBalance",
        };
      case "estAnnual":
        return {
          data: c.earnings.data,
          title: "Est. annual earnings",
          subtitle: "Estimated trend from portfolio · $/yr in header is current KPI",
          currentValue: totalEstAnnualUsd,
          tabType: "estAnnual",
          showReferenceLine: false,
        };
      case "blendedApy":
        return {
          data: c.netBalance.data,
          title: "Blended est. APY",
          subtitle: "Portfolio value over time · blended APY is shown in the KPI tile",
          currentValue: c.netBalance.currentValue,
          tabType: "netBalance",
        };
      case "rewards":
        return {
          data: c.rewards.data,
          title: c.rewards.title,
          subtitle: c.rewards.subtitle,
          currentValue: c.rewards.currentValue,
          tabType: "rewards",
        };
      default:
        return {
          data: c.netBalance.data,
          title: c.netBalance.title,
          subtitle: c.netBalance.subtitle,
          currentValue: c.netBalance.currentValue,
          tabType: "netBalance",
        };
    }
  }, [chartConfig, chartKpi, totalEstAnnualUsd]);

  useEffect(() => {
    if (chartKpi === "rewards" && !rewardsEnabled) {
      setChartKpi("portfolio");
    }
  }, [chartKpi, rewardsEnabled]);

  useEffect(() => {
    document.title = "Dashboard | STRATO";

    const claimReturnUrl = localStorage.getItem("claimReturnUrl");
    if (claimReturnUrl && isLoggedIn) {
      localStorage.removeItem("claimReturnUrl");
      navigate(claimReturnUrl, { replace: true });
      return;
    }

    const hasExistingEarningAssets = earningAssets.length > 0;
    const hasExistingInactiveTokens = inactiveTokens.length > 0;

    getEarningAssets(!hasExistingEarningAssets);

    if (isLoggedIn) {
      getInactiveTokens(!hasExistingInactiveTokens);
      refreshLoans();
      refreshVaults();
    }
  }, [location.pathname, userAddress, getEarningAssets, getInactiveTokens, refreshLoans, refreshVaults, isLoggedIn, navigate]);

  useEffect(() => {
    localStorage.setItem("dashboard-chartKpi", chartKpi);
    localStorage.setItem("dashboard-timeRange", selectedTimeRange);
  }, [chartKpi, selectedTimeRange]);

  const netBalanceCacheRef = useRef(netBalanceHistoryCache);
  const rewardsCacheRef = useRef(rewardsHistoryCache);
  const cacheTimestampsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    netBalanceCacheRef.current = netBalanceHistoryCache;
    rewardsCacheRef.current = rewardsHistoryCache;
  }, [netBalanceHistoryCache, rewardsHistoryCache]);

  const tabConfig = useMemo(
    () => ({
      netBalance: {
        fetchFn: getBalanceHistory,
        setCache: setNetBalanceHistoryCache,
      },
      rewards: {
        fetchFn: getCataBalanceHistory,
        setCache: setRewardsHistoryCache,
      },
    }),
    [getBalanceHistory, getCataBalanceHistory, setNetBalanceHistoryCache, setRewardsHistoryCache]
  );

  useEffect(() => {
    if (!isLoggedIn) {
      setLoadingBalanceHistory(false);
      return;
    }

    const historyFetchTab: "netBalance" | "rewards" =
      chartKpi === "rewards" && rewardsEnabled ? "rewards" : "netBalance";
    let isMounted = true;

    const loadRange = async () => {
      const config = tabConfig[historyFetchTab];
      const cache =
        historyFetchTab === "netBalance" ? netBalanceCacheRef.current : rewardsCacheRef.current;
      const cacheKey = `${historyFetchTab}:${selectedTimeRange}`;
      const cached = cache[selectedTimeRange];
      const cachedAt = cacheTimestampsRef.current[cacheKey] || 0;
      const isFresh = Date.now() - cachedAt < 10_000;

      if (cached && cached.length > 0 && isFresh) {
        setLoadingBalanceHistory(false);
        return;
      }

      setLoadingBalanceHistory(true);
      try {
        const data = await config.fetchFn(selectedTimeRange, "");
        if (!isMounted) return;
        config.setCache(selectedTimeRange, data);
        cacheTimestampsRef.current[cacheKey] = Date.now();
      } catch {
        /* ignore */
      } finally {
        if (isMounted) {
          setLoadingBalanceHistory(false);
        }
      }
    };

    loadRange();

    return () => {
      isMounted = false;
    };
  }, [selectedTimeRange, chartKpi, tabConfig, setLoadingBalanceHistory, isLoggedIn, rewardsEnabled]);

  const onTimeRangeChange = useCallback((duration: string) => {
    setSelectedTimeRange(duration as TimeRange);
  }, []);

  useEffect(() => {
    if (!searchParams) return;
    const successParam = searchParams.get("success");

    if (successParam !== "false" && successParam !== "true") return;

    if (successParam === "true") {
      toast?.({
        title: "Purchase Successful",
        description: "Your purchase was completed successfully.",
      });
      navigate("/dashboard", { replace: true });
    }
  }, [searchParams]);

  const claimableTotal = userRewards ? computeTotalClaimableRewards(userRewards) : 0n;
  const claimableRewardsDisplay = formatTotalClaimablePointsDisplay(claimableTotal);
  const claimableRewardsWei = claimableTotal.toString();

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="Portfolio" />

        <main className="p-4 md:p-6 pb-24 md:pb-6 max-w-[1400px] mx-auto w-full">
          {contactEnabled && (
            <div className="mb-6">
              <div className="bg-gradient-to-r from-blue-500/10 via-blue-500/5 to-transparent border border-blue-200 dark:border-blue-800 rounded-xl p-4 md:p-5 hover:bg-blue-500/15 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="bg-blue-500 rounded-full p-1.5 shrink-0">
                      <Gem className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm md:text-base font-semibold text-foreground">Deposit physical gold & silver</h3>
                      <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
                        We are currently accepting gold and silver physical deposits for tokenizing into GOLDST and SILVST.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={() => setContactModalOpen(true)}
                    className="inline-flex items-center justify-center gap-2 shrink-0 h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
                  >
                    <Mail size={16} />
                    Contact us
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to view your portfolio, track rewards, and manage your assets" />
          )}
          {isLoggedIn && <LiquidationAlertBanner />}

          <PortfolioKpiStrip
            isLoggedIn={isLoggedIn}
            portfolioValueUsd={totalBalance}
            portfolioLoading={isLoadingNetBalance}
            change1mLabel={change1mLabel}
            estAnnualUsd={totalEstAnnualUsd}
            blendedApy={blendedApy}
            claimableRewardsDisplay={claimableRewardsDisplay}
            claimableRewardsWei={claimableRewardsWei}
            rewardsEnabled={rewardsEnabled}
            earningMetricsLoading={earningMetricsLoading}
            rewardsClaimableLoading={rewardsClaimableLoading}
            portfolioYieldRollup={portfolioYieldRollup}
            selectedChartKpi={isLoggedIn ? chartKpi : undefined}
            onSelectChartKpi={isLoggedIn ? setChartKpi : undefined}
          />

          <PortfolioPerformanceBlock
            chart={performanceChart}
            selectedTimeRange={selectedTimeRange}
            onTimeRangeChange={onTimeRangeChange}
            loadingBalanceHistory={loadingBalanceHistory}
            isLoggedIn={isLoggedIn}
          />

          <PortfolioInsightsRow
            isLoggedIn={isLoggedIn}
            rewardsEnabled={rewardsEnabled}
            claimableRewardsWei={claimableRewardsWei}
            claimableRewardsDisplay={claimableRewardsDisplay}
            blendedApy={blendedApy}
            onNavigateClaim={() => navigate("/dashboard/rewards")}
            earningMetricsLoading={earningMetricsLoading}
            rewardsClaimableLoading={rewardsClaimableLoading}
            portfolioYieldRollup={portfolioYieldRollup}
            idleTop={idleTop}
            easySavingsApyPct={easySavingsApyPct}
            topEarnDisplay={topEarnDisplay}
            recommendedLoading={recommendedActionsLoading}
          />

          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate("/dashboard/transfer")}
              className="gap-1.5"
            >
              <Send size={14} />
              Transfer
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate("/dashboard/borrow")} className="gap-1.5">
              <Book size={14} />
              Borrow
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate("/dashboard/swap")} className="gap-1.5">
              <ArrowRightLeft size={14} />
              Swap
            </Button>
          </div>

          <div className="mb-8">
            <PortfolioPositionsTable
              rows={positionRows}
              loading={loadingEarningAssets}
              guestMode={!isLoggedIn}
              yieldDetailLoading={!tokenApysLoaded && positionRows.length > 0}
            />
          </div>

          <PortfolioNonEarningAssets tokens={isLoggedIn ? inactiveTokens : []} loading={loadingInactiveTokens} />

          <PortfolioIdleHoldings
            rows={idleHoldingRows}
            loading={idleHoldingsLoading || (isLoggedIn && loadingInactiveTokens)}
            guestMode={!isLoggedIn}
          />

          <PortfolioBorrowingOverview
            guestMode={!isLoggedIn}
            loanData={loans}
            collateralRows={collateralInfo || []}
            loading={borrowingOverviewLoading}
          />

          <PortfolioRecentActivity isLoggedIn={isLoggedIn} />

          <div className="mb-8">
            <DashboardFAQ />
          </div>
        </main>
      </div>

      <MobileBottomNav />
      {contactEnabled && <ContactInquiryModal open={contactModalOpen} onOpenChange={setContactModalOpen} />}
    </div>
  );
};

export default Dashboard;
