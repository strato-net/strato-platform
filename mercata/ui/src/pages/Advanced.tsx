import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
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
import Mint from '@/components/cdp/v2/Mint';
import DebtPosition from '@/components/cdp/v2/DebtPosition';
import { useCDP } from '@/context/CDPContext';
import { CompactRewardsDisplay } from '@/components/rewards/CompactRewardsDisplay';
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';
import { useUserTokens } from '@/context/UserTokensContext';

const Advanced = () => {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"lending" | "swap" | "liquidations" | "safety" | "mint">("mint");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [borrowActiveTab, setBorrowActiveTab] = useState('vaults');

  // Handle query parameters for tab navigation from rewards page
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    const subtabParam = searchParams.get('subtab');

    if (tabParam && ['lending', 'swap', 'liquidations', 'safety', 'mint'].includes(tabParam)) {
      setActiveTab(tabParam as "lending" | "swap" | "liquidations" | "safety" | "mint");
    }

    if (subtabParam && ['vaults', 'bad-debt', 'liquidations'].includes(subtabParam)) {
      setBorrowActiveTab(subtabParam);
    }
  }, [searchParams]);
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
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Advanced" onMenuClick={() => setIsMobileSidebarOpen(true)} />
        
        <main className="px-6 pt-3 pb-6 max-w-7xl mx-auto">
          <Card className="mb-6 bg-transparent border-0 rounded-none shadow-none">
            <CardContent className="pt-6">
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "lending" | "swap" | "liquidations" | "safety" | "mint")} className="w-full">
                <TabsList className="grid w-full grid-cols-5 mb-4">
                  <TabsTrigger value="mint" className="text-sm sm:text-base">
                    Mint
                  </TabsTrigger>
                  <TabsTrigger value="lending" className="text-sm sm:text-base">
                    <span className="hidden sm:inline">Lending Pools</span>
                    <span className="sm:hidden">Lending</span>
                  </TabsTrigger>
                  <TabsTrigger value="swap" className="text-sm sm:text-base">
                    <span className="hidden sm:inline">Swap Pools</span>
                    <span className="sm:hidden">Swap</span>
                  </TabsTrigger>
                  <TabsTrigger value="safety" className="text-sm sm:text-base">
                    <span className="hidden sm:inline">Safety Module</span>
                    <span className="sm:hidden">Safety</span>
                  </TabsTrigger>
                  <TabsTrigger value="liquidations" className="text-sm sm:text-base">
                    <span className="hidden sm:inline">Liquidations</span>
                    <span className="sm:hidden">Liquidations</span>
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="mint">
                  <Tabs value={borrowActiveTab} onValueChange={(value) => setBorrowActiveTab(value)} className="w-full">
                    <TabsList className="grid w-full grid-cols-3 mb-4">
                      <TabsTrigger value="vaults" className="text-sm sm:text-base">
                        Vaults
                      </TabsTrigger>
                      <TabsTrigger value="bad-debt" className="text-sm sm:text-base">
                        Bad Debt
                      </TabsTrigger>
                      <TabsTrigger value="liquidations" className="text-sm sm:text-base">
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
    </div>
  );
};

export default Advanced;

