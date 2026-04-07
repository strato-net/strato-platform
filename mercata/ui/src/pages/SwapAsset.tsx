import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import SwapWidget from "@/components/swap/SwapWidget";
import SwapHistory from "@/components/swap/SwapHistory";
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";

const SwapAsset = () => {
  const { isLoggedIn } = useUser();
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Swap" />
        <main className="p-4 md:p-6">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to swap tokens and exchange digital assets" />
          )}
          <div className="max-w-2xl mx-auto space-y-4 md:space-y-6">
            {/* Main Swap Widget */}
            <div className="bg-card shadow-sm rounded-xl p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4 md:mb-6">
                <h2 className="text-base md:text-xl font-semibold">Exchange your digital assets</h2>
              </div>
              <SwapWidget 
                userRewards={userRewards}
                rewardsLoading={rewardsLoading}
                guestMode={!isLoggedIn}
              />
            </div>
          </div>
          
          {/* Separate Swap History Section - Full Width (hidden on mobile) */}
          {isLoggedIn && (
            <div className="hidden md:block mt-6 md:mt-8 max-w-6xl mx-auto">
              <div className="bg-card shadow-sm rounded-xl p-6 border border-border">
                <SwapHistory />
              </div>
            </div>
          )}
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default SwapAsset;
