import { useState } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import SwapWidget from "@/components/swap/SwapWidget";
import SwapHistory from "@/components/swap/SwapHistory";
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';

const SwapAsset = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Swap Assets" onMenuClick={() => setIsMobileSidebarOpen(true)} />
        <main className="p-6">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Main Swap Widget */}
            <div className="bg-card shadow-md rounded-lg p-6 border border-border">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Exchange your digital assets</h2>
              </div>
              <SwapWidget 
                userRewards={userRewards}
                rewardsLoading={rewardsLoading}
              />
            </div>
          </div>
          
          {/* Separate Swap History Section - Full Width */}
          <div className="mt-8 max-w-6xl mx-auto">
            <div className="bg-card shadow-md rounded-lg p-6 border border-border">
              <SwapHistory />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default SwapAsset;