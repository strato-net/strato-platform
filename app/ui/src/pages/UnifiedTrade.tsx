import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import RouterWidget from "@/components/router/RouterWidget";
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import RecentTransactions from "@/components/bridge/RecentTransactions";
import { useState } from "react";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import { useTradeBridgeCatalog } from "@/hooks/trade/useTradeTokens";
import { useSearchParams } from "react-router-dom";

const UnifiedTrade = () => {
  const { isLoggedIn } = useUser();
  const [searchParams] = useSearchParams();
  const [routeRefreshKey, setRouteRefreshKey] = useState(0);
  const { userRewards } = useRewardsUserInfo();
  const bridgeCatalog = useTradeBridgeCatalog();

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
          <DashboardHeader title="Trade" />
        <main className="flex-1 p-4 md:p-6">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to trade across STRATO and external networks in one route" />
          )}
          <div className="mx-auto max-w-7xl space-y-6">
            <p className="text-muted-foreground">From an external network into any STRATO asset—swap, save, or earn yield in one step.</p>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
              <div className="xl:col-span-7">
                <RouterWidget
                  key={JSON.stringify([searchParams.get("tokenIn"), searchParams.get("tokenOut"), searchParams.get("pool")])}
                  initialTokenIn={searchParams.get("tokenIn") ?? ""}
                  initialTokenOut={searchParams.get("tokenOut") ?? ""}
                  initialPool={searchParams.get("pool") ?? ""}
                  guestMode={!isLoggedIn}
                  userRewards={userRewards}
                  bridgeCatalog={bridgeCatalog}
                  onTransactionSubmitted={() =>
                    setRouteRefreshKey((key) => key + 1)
                  }
                />
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
            </div>
          </div>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
};

export default UnifiedTrade;
