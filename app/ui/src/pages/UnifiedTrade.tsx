import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import RouterWidget from "@/components/router/RouterWidget";
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import RecentTransactions from "@/components/bridge/RecentTransactions";
import { useCallback, useState } from "react";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import PairSwapHistory from "@/components/router/PairSwapHistory";
import { Route, ShieldCheck } from "lucide-react";
import { useTradeBridgeCatalog } from "@/hooks/trade/useTradeTokens";

const UnifiedTrade = () => {
  const { isLoggedIn } = useUser();
  const [routeRefreshKey, setRouteRefreshKey] = useState(0);
  const [historyPair, setHistoryPair] = useState<{
    tokenIn?: string;
    tokenOut?: string;
  }>({});
  const { userRewards } = useRewardsUserInfo();
  const bridgeCatalog = useTradeBridgeCatalog();
  const handlePairChange = useCallback((tokenIn?: string, tokenOut?: string) => {
    setHistoryPair({ tokenIn, tokenOut });
  }, []);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
          <DashboardHeader title="Bridge & Trade" />
        <main className="flex-1 p-4 md:p-6">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to trade across STRATO and external networks in one route" />
          )}
          <div className="mx-auto max-w-7xl space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
                  One trade. One clear route.
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  Swap on STRATO or deposit from an external network and route
                  directly into your destination asset.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-medium">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5">
                  <Route className="h-3.5 w-3.5 text-primary" />
                  Multi-step routing
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                  Bridge fallback protection
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
              <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm xl:col-span-7">
                <div className="border-b border-border/60 bg-gradient-to-r from-primary/[0.07] via-transparent to-transparent px-4 py-4 md:px-6">
                  <h3 className="font-semibold">Build your trade</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Select a source, destination and amount to preview execution.
                  </p>
                </div>
                <div className="p-4 md:p-6">
                  <RouterWidget
                    guestMode={!isLoggedIn}
                    userRewards={userRewards}
                    bridgeCatalog={bridgeCatalog}
                    onPairChange={handlePairChange}
                    onTransactionSubmitted={() =>
                      setRouteRefreshKey((key) => key + 1)
                    }
                  />
                </div>
              </div>
              <div className="xl:col-span-5">
                <RecentTransactions
                  fundingMode="bridge"
                  includeRoutes
                  routeRefreshKey={routeRefreshKey}
                  networkOptions={bridgeCatalog.availableNetworks}
                  routeTokens={bridgeCatalog.bridgeableTokens}
                />
              </div>
              <div className="xl:col-span-12">
                <PairSwapHistory
                  tokenIn={historyPair.tokenIn}
                  tokenOut={historyPair.tokenOut}
                />
              </div>
            </div>
          </div>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
};

export default UnifiedTrade;
