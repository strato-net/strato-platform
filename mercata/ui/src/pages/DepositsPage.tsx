import { useEffect } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileBottomNav from '../components/dashboard/MobileBottomNav';
import { useUser } from '@/context/UserContext';
import BridgeIn from '@/components/bridge/BridgeIn';
import RecentTransactions from '@/components/bridge/RecentTransactions';
import { useBridgeContext } from '@/context/BridgeContext';
import GuestSignInBanner from '@/components/ui/GuestSignInBanner';

const DepositsPage = () => {
  const { isLoggedIn } = useUser();
  const { loadNetworksAndTokens } = useBridgeContext();

  useEffect(() => {
    loadNetworksAndTokens().catch((error) => {
      console.error('Failed to load networks and tokens:', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen bg-background overflow-hidden pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="h-screen flex flex-col transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Fund" subtitle="Bring assets onto STRATO and start earning" />
        <main className="flex-1 p-4 md:p-6 pb-16 md:pb-6 overflow-y-auto">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to deposit and start earning" />
          )}
          <div className="mb-8 grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-7">
              <BridgeIn guestMode={!isLoggedIn} />
            </div>
            <div className="xl:col-span-5">
              <RecentTransactions />
            </div>
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default DepositsPage;
