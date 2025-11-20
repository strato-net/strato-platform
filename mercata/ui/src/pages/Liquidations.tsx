import { useState } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import LiquidationsSection from '@/components/dashboard/LiquidationsSection';

const Liquidations = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Liquidations" onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="p-6">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Liquidations</CardTitle>
              <CardDescription>
                View and participate in liquidation opportunities
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LiquidationsSection />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default Liquidations;
