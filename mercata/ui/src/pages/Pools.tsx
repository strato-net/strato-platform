import { useState } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import LendingPoolSection from '@/components/dashboard/LendingPoolSection';
import SwapPoolsSection from '@/components/dashboard/SwapPoolsSection';
import LiquidationsSection from '@/components/dashboard/LiquidationsSection';

const Pools = () => {
  const [activeTab, setActiveTab] = useState<"lending" | "swap" | "liquidations">("lending");
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Pools" onMenuClick={() => setIsMobileSidebarOpen(true)} />
        
        <main className="p-6">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Liquidity Pools</CardTitle>
              <CardDescription>
                Provide liquidity to earn rewards and enable decentralized trading
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "lending" | "swap" | "liquidations")} className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-4">
                  <TabsTrigger value="lending" className="text-xs sm:text-sm">
                    <span className="hidden sm:inline">Lending Pools</span>
                    <span className="sm:hidden">Lending</span>
                  </TabsTrigger>
                  <TabsTrigger value="swap" className="text-xs sm:text-sm">
                    <span className="hidden sm:inline">Swap Pools</span>
                    <span className="sm:hidden">Swap</span>
                  </TabsTrigger>
                  <TabsTrigger value="liquidations" className="text-xs sm:text-sm">
                    <span className="hidden sm:inline">Liquidations</span>
                    <span className="sm:hidden">Liquidations</span>
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="lending">
                  <LendingPoolSection />
                </TabsContent>
                <TabsContent value="swap">
                  <SwapPoolsSection />
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

export default Pools;
