import { useState } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import BridgeWidget from '@/components/bridge/BridgeWidget';

const BridgeAssets = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Bridge Assets" onMenuClick={() => setIsMobileSidebarOpen(true)} />
        <main className="p-6">
          <div className="max-w-2xl mx-auto">
            <BridgeWidget />
          </div>
        </main>
      </div>
    </div>
  );
};

export default BridgeAssets;