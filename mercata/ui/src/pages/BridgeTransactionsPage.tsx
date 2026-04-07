import React from 'react';
import BridgeTransactionsComponent from '../components/dashboard/BridgeTransactionsPage';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import MobileBottomNav from '@/components/dashboard/MobileBottomNav';

const BridgeTransactionsPage = () => {
  const navigate = useNavigate();

  return (
    <div className="h-screen bg-background overflow-hidden pb-16 md:pb-0">
      <DashboardSidebar />
      <div className="h-screen flex flex-col transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Bridge Transactions" />
        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6 overflow-y-auto">
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
              className="absolute left-0 top-0 rounded-full hover:bg-gray-100 w-10 h-10 border border-gray-200 shadow-sm"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="pl-12">
              <BridgeTransactionsComponent isAdmin={false} />
            </div>
          </div>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
};

export default BridgeTransactionsPage; 