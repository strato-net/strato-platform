import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import RouterWidget from "@/components/router/RouterWidget";
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import RecentTransactions from "@/components/bridge/RecentTransactions";
import { useState } from "react";

const UnifiedTrade = () => {
  const { isLoggedIn } = useUser();
  const [routeRefreshKey, setRouteRefreshKey] = useState(0);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardHeader />
      <div className="flex">
        <DashboardSidebar />
        <main className="flex-1 p-4 md:p-6">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to test unified trading and bridge routes" />
          )}
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="bg-card shadow-sm rounded-xl p-4 md:p-6 border border-border xl:col-span-7">
              <div className="flex items-center justify-between mb-4 md:mb-6">
                <h2 className="text-base md:text-xl font-semibold">
                  Unified Trade
                </h2>
              </div>
              <RouterWidget
                guestMode={!isLoggedIn}
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
              />
            </div>
          </div>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
};

export default UnifiedTrade;
