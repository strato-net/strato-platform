import { useState, useCallback } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileBottomNav from '../components/dashboard/MobileBottomNav';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import LendingPoolSection from '@/components/dashboard/LendingPoolSection';
import SwapPoolsSection from '@/components/dashboard/SwapPoolsSection';
import LiquidationsSection from '@/components/dashboard/LiquidationsSection';
import SafetyModuleSection from '@/components/dashboard/SafetyModuleSection';
import MintPlanner from '@/components/cdp/MintPlanner';
import VaultsList from '@/components/cdp/VaultsList';
import LiquidationsView from '@/components/cdp/LiquidationsView';
import BadDebtView from '@/components/cdp/BadDebtView';
// New v2 components
import Mint from '@/components/cdp/v2/components/Mint/Mint';
import DebtPosition from '@/components/cdp/v2/components/DebtPosition';
import { useCDP } from '@/context/CDPContext';
import { CompactRewardsDisplay } from '@/components/rewards/CompactRewardsDisplay';
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';
import { useUserTokens } from '@/context/UserTokensContext';

const Advanced = () => {
  const [activeTab, setActiveTab] = useState<"lending" | "swap" | "liquidations" | "safety" | "mint">("mint");
  const [borrowActiveTab, setBorrowActiveTab] = useState('vaults');
  const { refreshVaults } = useCDP();
  const [vaultsRefreshTrigger, setVaultsRefreshTrigger] = useState(0);
  const [mintPlannerRefreshTrigger, setMintPlannerRefreshTrigger] = useState(0);
  const { userRewards, loading: rewardsLoading, refetch: refetchRewards } = useRewardsUserInfo();
  const { fetchTokens } = useUserTokens();

  // Unified refresh function that refreshes ALL CDP components after any transaction
  // This ensures MintPlanner, VaultsList, and MintWidget all have fresh data
  const refreshAllCDPComponents = useCallback(async () => {
    // Increment both triggers to refresh both MintPlanner and VaultsList
    setVaultsRefreshTrigger(prev => prev + 1);
    setMintPlannerRefreshTrigger(prev => prev + 1);
    
    // Refresh CDP context
    refreshVaults();
    
    // Refresh all related data in parallel
    await Promise.all([
      refetchRewards(),
      fetchTokens(), // Token balances used by all components
    ]);
  }, [refreshVaults, refetchRewards, fetchTokens]);

  // Use the unified refresh for all CDP component callbacks
  const handleVaultActionSuccess = useCallback(async () => {
    await refreshAllCDPComponents();
  }, [refreshAllCDPComponents]);

  const handleQuickMintSuccess = useCallback(async () => {
    await refreshAllCDPComponents();
  }, [refreshAllCDPComponents]);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Advanced" />
        
        <main className="px-3 md:px-6 pt-2 md:pt-3 pb-2 md:pb-6 max-w-7xl mx-auto">
          <Card className="mb-2 md:mb-6 bg-transparent border-0 rounded-none shadow-none">
            <CardContent className="p-0 md:pt-4">
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "lending" | "swap" | "liquidations" | "safety" | "mint")} className="w-full">
                <TabsList className="grid w-full grid-cols-5 mb-3 md:mb-4 h-auto gap-0.5 md:gap-1">
                  <TabsTrigger value="mint" className="text-[10px] md:text-sm py-1.5 md:py-2 px-0.5 md:px-3">
                    Mint
                  </TabsTrigger>
                  <TabsTrigger value="lending" className="text-[10px] md:text-sm py-1.5 md:py-2 px-0.5 md:px-3">
                    Lending
                  </TabsTrigger>
                  <TabsTrigger value="swap" className="text-[10px] md:text-sm py-1.5 md:py-2 px-0.5 md:px-3">
                    Swap
                  </TabsTrigger>
                  <TabsTrigger value="safety" className="text-[10px] md:text-sm py-1.5 md:py-2 px-0.5 md:px-3">
                    Safety
                  </TabsTrigger>
                  <TabsTrigger value="liquidations" className="text-[10px] md:text-sm py-1.5 md:py-2 px-0.5 md:px-3">
                    Liquidations
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="mint">
                  <Tabs value={borrowActiveTab} onValueChange={(value) => setBorrowActiveTab(value)} className="w-full">
                    <TabsList className="grid w-full grid-cols-3 mb-3 md:mb-4 h-auto">
                      <TabsTrigger value="vaults" className="text-xs md:text-sm py-2 px-1 md:px-3">
                        Vaults
                      </TabsTrigger>
                      <TabsTrigger value="bad-debt" className="text-xs md:text-sm py-2 px-1 md:px-3">
                        Bad Debt
                      </TabsTrigger>
                      <TabsTrigger value="liquidations" className="text-xs md:text-sm py-2 px-1 md:px-3">
                        Liquidations
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="vaults">
                      <div className="flex flex-col lg:flex-row gap-6">
                        {/* Left Column - Mint Section (New v2) */}
                        <div className="w-full lg:w-[60%]">
                          <Mint
                            onSuccess={handleQuickMintSuccess}
                            refreshTrigger={mintPlannerRefreshTrigger}
                          />
                        </div>

                        {/* Right Column - Position and Vaults (New v2) */}
                        <div className="w-full lg:w-[40%] space-y-6">
                          <DebtPosition refreshTrigger={vaultsRefreshTrigger} />
                          <VaultsList
                            refreshTrigger={vaultsRefreshTrigger}
                            onVaultActionSuccess={handleVaultActionSuccess}
                          />
                        </div>
                      </div>
                    </TabsContent>
                    <TabsContent value="bad-debt">
                      <BadDebtView />
                    </TabsContent>
                    <TabsContent value="liquidations">
                      <LiquidationsView />
                    </TabsContent>
                  </Tabs>
                </TabsContent>
                <TabsContent value="lending">
                  <LendingPoolSection />
                </TabsContent>
                <TabsContent value="swap">
                  <SwapPoolsSection />
                </TabsContent>
                <TabsContent value="safety">
                  <SafetyModuleSection />
                </TabsContent>
                <TabsContent value="liquidations">
                  <LiquidationsSection />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default Advanced;

