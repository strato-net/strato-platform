import { useState } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import LendingPoolSection from '@/components/dashboard/LendingPoolSection';
import SwapPoolsSection from '@/components/dashboard/SwapPoolsSection';
import LiquidationsSection from '@/components/dashboard/LiquidationsSection';

const Pools = () => {
  const [activeTab, setActiveTab] = useState<"lending" | "swap" | "liquidations">("lending");

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      
      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 16rem)' }}>
        <DashboardHeader title="Pools" />
        
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
                <TabsList className="grid w-full md:w-[600px] grid-cols-3 mb-4">
                  <TabsTrigger value="lending">Lending Pools</TabsTrigger>
                  <TabsTrigger value="swap">Swap Pools</TabsTrigger>
                  <TabsTrigger value="liquidations">Liquidations</TabsTrigger>
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
