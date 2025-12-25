import React from 'react';
import BridgeTransactionsComponent from '../components/dashboard/BridgeTransactionsPage';
import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import MobileBottomNav from '@/components/dashboard/MobileBottomNav';

const BridgeTransactionsPage = () => {
  return (
    <div className="h-screen bg-background overflow-hidden">
      <DashboardSidebar />
      <MobileBottomNav />
      <div className="flex flex-col transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)', height: '100vh' }}>
        <DashboardHeader title="Bridge Transactions" />
        <main className="flex-1 p-3 md:p-6 pb-20 md:pb-6 overflow-auto">
          <BridgeTransactionsComponent isAdmin={false} />
        </main>
      </div>
    </div>
  );
};

export default BridgeTransactionsPage; 