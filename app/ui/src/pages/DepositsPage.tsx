import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileBottomNav from '../components/dashboard/MobileBottomNav';
import { useUser } from '@/context/UserContext';
import BridgeIn from '@/components/bridge/BridgeIn';
import RecentTransactions from '@/components/bridge/RecentTransactions';
import { useBridgeContext } from '@/context/BridgeContext';
import GuestSignInBanner from '@/components/ui/GuestSignInBanner';
import { normBridgeAddr } from '@/lib/bridgeLinks';

const DepositsPage = () => {
  const { isLoggedIn, loading, isAppAuthenticated, externalWalletAddress } = useUser();
  const { loadNetworksAndTokens, selectTokenByStratoAddress } = useBridgeContext();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab');
  const tokenParam = searchParams.get('token');
  const metalParam = searchParams.get('metal');
  const [fundingMode, setFundingMode] = useState<"bridge" | "metals">(() =>
    tokenParam ? 'bridge' : tab === 'metals' || metalParam ? 'metals' : 'bridge'
  );

  useEffect(() => {
    if (tokenParam) {
      setFundingMode('bridge');
      return;
    }
    if (tab === 'metals' || metalParam) setFundingMode('metals');
  }, [tab, tokenParam, metalParam]);

  const [metalRefreshKey, setMetalRefreshKey] = useState(0);
  const handleMetalPurchase = useCallback(() => setMetalRefreshKey(k => k + 1), []);

  useEffect(() => {
    if (loading || !isLoggedIn) return;
    if (!isAppAuthenticated && !externalWalletAddress) return;
    loadNetworksAndTokens().catch((error) => {
      console.error('Failed to load networks and tokens:', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isLoggedIn, isAppAuthenticated, externalWalletAddress]);

  // Explore Buy deep-link: preselect Bridge In receive token (works for guests too)
  useEffect(() => {
    const addr = normBridgeAddr(tokenParam || '');
    if (!addr) return;
    let cancelled = false;
    selectTokenByStratoAddress(addr).catch((error) => {
      if (!cancelled) console.error('Failed to select bridge token:', error);
    });
    return () => {
      cancelled = true;
    };
  }, [tokenParam, selectTokenByStratoAddress]);

  return (
    <div className="h-screen bg-background overflow-hidden pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="h-screen flex flex-col transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Fund" />
        <main className="flex-1 p-4 md:p-6 pb-16 md:pb-6 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to deposit and start earning" />
          )}
          <div className="mb-8 grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-7">
              <BridgeIn guestMode={!isLoggedIn} fundingMode={fundingMode} initialMetalAddress={metalParam} onFundingModeChange={setFundingMode} onMetalPurchase={handleMetalPurchase} />
            </div>
            <div className="xl:col-span-5">
              <RecentTransactions fundingMode={fundingMode} metalRefreshKey={metalRefreshKey} />
            </div>
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default DepositsPage;
