import { useState } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import SafetyModuleSection from '@/components/dashboard/SafetyModuleSection';

const SafetyModule = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Safety Module" onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="p-6">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Safety Module</CardTitle>
              <CardDescription>
                Stake tokens in the safety module to secure the protocol and earn rewards
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SafetyModuleSection />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default SafetyModule;
