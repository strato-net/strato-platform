import { useState } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import BridgeWidget from '@/components/bridge/BridgeWidget';
import BridgeHistory from '@/components/bridge/BridgeHistory';

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
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Bridge Widget - Left Side */}
              <div className="bg-white shadow-md rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-6">Bridge your digital assets</h2>
                <BridgeWidget />
              </div>
              
              {/* Bridge History - Right Side */}
              <div className="bg-white shadow-md rounded-lg p-6">
                <BridgeHistory />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default BridgeAssets;