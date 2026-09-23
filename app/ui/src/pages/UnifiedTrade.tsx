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
import { useTradeBridgeCatalog } from "@/hooks/trade/useTradeTokens";
import { useSearchParams } from "react-router-dom";

const UnifiedTrade = () => {
  const { isLoggedIn } = useUser();
  const [searchParams] = useSearchParams();
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
            <h2 className="text-lg font-semibold">Trade on STRATO or deposit from another network.</h2>

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
              <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm lg:col-span-7">
                <div className="border-b border-border/60 bg-gradient-to-r from-primary/[0.07] via-transparent to-transparent px-4 py-4 md:px-6">
                  <h3 className="font-semibold">Build your trade</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Select a source, destination and amount to preview execution.
                  </p>
                </div>
                <div className="p-4 md:p-6">
                  <RouterWidget
                    key={JSON.stringify([searchParams.get("tokenIn"), searchParams.get("tokenOut"), searchParams.get("pool")])}
                    initialTokenIn={searchParams.get("tokenIn") ?? ""}
                    initialTokenOut={searchParams.get("tokenOut") ?? ""}
                    initialPool={searchParams.get("pool") ?? ""}
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
              <div className="lg:col-span-5">
                <RecentTransactions
                  fundingMode="bridge"
                  includeRoutes
                  routeRefreshKey={routeRefreshKey}
                  networkOptions={bridgeCatalog.availableNetworks}
                  routeTokens={bridgeCatalog.bridgeableTokens}
                />
              </div>
              {historyPair.tokenIn && historyPair.tokenOut && <details className="lg:col-span-12">
                <summary className="cursor-pointer text-sm text-muted-foreground">Market activity · View recent trades for this pair</summary>
                <div className="mt-3"><PairSwapHistory
                  tokenIn={historyPair.tokenIn}
                  tokenOut={historyPair.tokenOut}
                /></div>
              </details>}
            </div>
          </div>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
};

export default UnifiedTrade;
