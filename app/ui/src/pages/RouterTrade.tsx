import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import RouterWidget from "@/components/router/RouterWidget";
import { TradeFormProvider } from "@/context/TradeFormContext";
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";

const RouterTrade = () => {
  const { isLoggedIn } = useUser();
  const { userRewards } = useRewardsUserInfo();

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Trade-New" />
        <main className="p-4 md:p-6">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to trade tokens and exchange digital assets" />
          )}
          <TradeFormProvider>
            <div className="max-w-2xl mx-auto space-y-4 md:space-y-6">
              <div className="bg-card shadow-sm rounded-xl p-4 md:p-6 border border-border">
                <div className="flex items-center justify-between mb-4 md:mb-6">
                  <h2 className="text-base md:text-xl font-semibold">Trade your assets</h2>
                </div>
                <RouterWidget userRewards={userRewards} guestMode={!isLoggedIn} />
              </div>
            </div>
          </TradeFormProvider>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default RouterTrade;
