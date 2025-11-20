import { useState } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import SwapPoolsSection from '@/components/dashboard/SwapPoolsSection';

const SwapPools = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Swap Pools" onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="p-6">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Swap Pools</CardTitle>
              <CardDescription>
                Provide liquidity to swap pools and earn trading fees
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SwapPoolsSection />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default SwapPools;
