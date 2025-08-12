import React, { useState } from 'react';
import BridgeTransactionsComponent from '../components/dashboard/BridgeTransactionsPage';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import MobileSidebar from '@/components/dashboard/MobileSidebar';

const BridgeTransactionsPage = () => {
  const navigate = useNavigate();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Bridge Transactions" onMenuClick={() => setIsMobileSidebarOpen(true)} />
        <main className="p-6">
          <div className="max-w-6xl mx-auto">
            <div className="mb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/dashboard/bridge')}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Bridge
              </Button>
            </div>
            <div className="bg-white shadow-md rounded-lg p-6">
              <BridgeTransactionsComponent isOpen={true} onClose={() => {}} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default BridgeTransactionsPage; 