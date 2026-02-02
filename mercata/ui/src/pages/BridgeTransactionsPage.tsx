import React from 'react';
import BridgeTransactionsComponent from '../components/dashboard/BridgeTransactionsPage';
import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import MobileBottomNav from '@/components/dashboard/MobileBottomNav';

const BridgeTransactionsPage = () => {
  return (
    <div className="h-screen bg-background overflow-hidden pb-16 md:pb-0">
      <DashboardSidebar />
      <div className="h-screen flex flex-col transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Bridge Transactions" />
        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6 overflow-y-auto">
          <BridgeTransactionsComponent isAdmin={false} />
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
};

export default BridgeTransactionsPage; 