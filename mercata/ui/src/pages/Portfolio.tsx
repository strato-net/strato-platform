import { useEffect, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import GuestPromoSection from "@/components/dashboard/GuestPromoSection";
import LiquidationAlertBanner from "@/components/ui/LiquidationAlertBanner";
import PortfolioOverviewHeader from "@/components/portfolio/PortfolioOverviewHeader";
import PortfolioAllocationChart from "@/components/portfolio/PortfolioAllocationChart";
import PortfolioGroupList from "@/components/portfolio/PortfolioGroupList";
import PortfolioTransactionPanel from "@/components/portfolio/PortfolioTransactionPanel";
import { usePortfolio } from "@/hooks/usePortfolio";
import { usePortfolioPnL } from "@/hooks/usePortfolioPnL";
import { useMyActivityEvents } from "@/hooks/useMyActivityEvents";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { useCDP } from "@/context/CDPContext";
import { useLendingContext } from "@/context/LendingContext";

const Portfolio = () => {
  const { isLoggedIn } = useUser();
  const { getEarningAssets } = useTokenContext();
  const { refreshVaults } = useCDP();
  const { refreshLoans } = useLendingContext();

  // Ensure the underlying contexts have fresh data on entry (they poll after).
  useEffect(() => {
    getEarningAssets(true);
    if (isLoggedIn) {
      refreshVaults();
      refreshLoans(true);
    }
  }, [isLoggedIn, getEarningAssets, refreshVaults, refreshLoans]);

  const pnl = usePortfolioPnL(isLoggedIn);
  const summary = usePortfolio(pnl);
  const { events, loading: activityLoading } = useMyActivityEvents(isLoggedIn);

  // Only surface P&L once we have flow data to estimate from.
  const showPnL = isLoggedIn && Object.keys(pnl).length > 0;

  // Which asset group's transactions the side panel shows (defaults to the first).
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const effectiveKey = selectedKey ?? summary.groups[0]?.key ?? null;
  const selectedGroup = summary.groups.find((g) => g.key === effectiveKey) ?? null;

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="Portfolio" subtitle="Your assets, positions & performance" />

        <main className="p-4 md:p-6 pb-24 md:pb-6">
          {!isLoggedIn && <GuestPromoSection variant={1} />}

          {isLoggedIn && <LiquidationAlertBanner />}

          {/* Row 1: overview KPIs (left) + allocation donut (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mb-4 md:mb-6 items-stretch">
            <div className="lg:col-span-2">
              <PortfolioOverviewHeader summary={summary} showPnL={showPnL} />
            </div>
            <div className="lg:col-span-1">
              <PortfolioAllocationChart groups={summary.groups} isLoading={summary.isLoading} />
            </div>
          </div>

          {/* Row 2: assets by category (left) + transaction history for selection (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 items-start">
            <div className="lg:col-span-2">
              <PortfolioGroupList
                groups={summary.groups}
                isLoading={summary.isLoading}
                showPnL={showPnL}
                selectedKey={effectiveKey}
                onSelect={setSelectedKey}
              />
            </div>
            <div className="lg:col-span-1 lg:sticky lg:top-6">
              <PortfolioTransactionPanel
                selectedGroup={selectedGroup}
                events={events}
                loading={activityLoading}
              />
            </div>
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default Portfolio;
