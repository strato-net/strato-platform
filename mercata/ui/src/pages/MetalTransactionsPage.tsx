import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import MobileBottomNav from '@/components/dashboard/MobileBottomNav';
import MetalTransactionDetails from '@/components/dashboard/MetalTransactionDetails';

const MetalTransactionsPage = () => {
  return (
    <div className="h-screen bg-background overflow-hidden pb-16 md:pb-0">
      <DashboardSidebar />
      <div className="h-screen flex flex-col transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Metal Purchases" />
        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6 overflow-y-auto">
          <MetalTransactionDetails />
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
};

export default MetalTransactionsPage;
