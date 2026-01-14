import { useState } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import LendingPoolSection from '@/components/dashboard/LendingPoolSection';
import SwapPoolsSection from '@/components/dashboard/SwapPoolsSection';
import LiquidationsSection from '@/components/dashboard/LiquidationsSection';
import SafetyModuleSection from '@/components/dashboard/SafetyModuleSection';
import MintWidget from '@/components/cdp/MintWidget';
import VaultsList from '@/components/cdp/VaultsList';
import LiquidationsView from '@/components/cdp/LiquidationsView';
import BadDebtView from '@/components/cdp/BadDebtView';
import { useCDP } from '@/context/CDPContext';
import { CompactRewardsDisplay } from '@/components/rewards/CompactRewardsDisplay';
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';

const Advanced = () => {
  const [activeTab, setActiveTab] = useState<"lending" | "swap" | "liquidations" | "safety" | "mint">("mint");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [borrowActiveTab, setBorrowActiveTab] = useState('vaults');
  const { refreshVaults } = useCDP();
  const [vaultsRefreshTrigger, setVaultsRefreshTrigger] = useState(0);
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

  const handleBorrowSuccess = () => {
    setVaultsRefreshTrigger(prev => prev + 1);
  };

  const handleVaultActionSuccess = () => {
    refreshVaults();
  };

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
                    <span className="hidden sm:inline">Mint USDST</span>
                    <span className="sm:hidden">Mint</span>
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
                      <div className="space-y-6">

                        <div className="border border-border bg-card rounded-xl p-4 flex flex-col shadow-sm">
                          <MintWidget onSuccess={handleBorrowSuccess} />
                        </div>
                        <VaultsList 
                          refreshTrigger={vaultsRefreshTrigger} 
                          onVaultActionSuccess={handleVaultActionSuccess}
                        />
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

