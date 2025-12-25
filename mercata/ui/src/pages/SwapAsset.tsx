import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import SwapWidget from "@/components/swap/SwapWidget";
import SwapHistory from "@/components/swap/SwapHistory";
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';

const SwapAsset = () => {
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <DashboardSidebar />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Swap" />
        <main className="p-3 md:p-6 pb-20 md:pb-6">
          <div className="max-w-2xl mx-auto space-y-4 md:space-y-6">
            {/* Main Swap Widget */}
            <div className="bg-card shadow-sm rounded-none md:rounded-xl p-4 md:p-6 border-y md:border border-border">
              <div className="flex items-center justify-between mb-4 md:mb-6">
                <h2 className="text-base md:text-xl font-semibold">Exchange your digital assets</h2>
              </div>
              <SwapWidget 
                userRewards={userRewards}
                rewardsLoading={rewardsLoading}
              />
            </div>
          </div>
          
          {/* Separate Swap History Section - Full Width */}
          <div className="mt-6 md:mt-8 max-w-6xl mx-auto">
            <div className="bg-card shadow-sm rounded-none md:rounded-xl p-3 md:p-6 border-y md:border border-border">
              <SwapHistory />
            </div>
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default SwapAsset;