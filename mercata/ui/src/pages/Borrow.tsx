import { useState, useCallback, useEffect } from "react";
import { useSearchParams } from 'react-router-dom';
import { useUser } from "@/context/UserContext";
import { useCDP } from '@/context/CDPContext';
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';
import { useUserTokens } from '@/context/UserTokensContext';
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Mint from '@/components/cdp/v2/components/Mint/Mint';
import DebtPosition from '@/components/cdp/v2/components/DebtPosition';
import VaultsList from '@/components/cdp/VaultsList';
import BadDebtView from '@/components/cdp/BadDebtView';
import LiquidationsView from '@/components/cdp/LiquidationsView';
import GuestSignInBanner from '@/components/ui/GuestSignInBanner';

const Borrow = () => {
  const { isLoggedIn } = useUser();
  const { refreshVaults } = useCDP();
  const { refetch: refetchRewards } = useRewardsUserInfo();
  const { fetchTokens } = useUserTokens();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('vaults');
  const [vaultsRefreshTrigger, setVaultsRefreshTrigger] = useState(0);
  const [mintPlannerRefreshTrigger, setMintPlannerRefreshTrigger] = useState(0);

  useEffect(() => {
    document.title = "Borrow | STRATO";
  }, []);

  useEffect(() => {
    const subtabParam = searchParams.get('subtab');
    if (subtabParam && ['vaults', 'bad-debt', 'liquidations'].includes(subtabParam)) {
      setActiveTab(subtabParam);
    }
  }, [searchParams]);

  const refreshAllCDPComponents = useCallback(async () => {
    setVaultsRefreshTrigger(prev => prev + 1);
    setMintPlannerRefreshTrigger(prev => prev + 1);
    refreshVaults();
    await Promise.all([
      refetchRewards(),
      fetchTokens(),
    ]);
  }, [refreshVaults, refetchRewards, fetchTokens]);

  const handleVaultActionSuccess = useCallback(async () => {
    await refreshAllCDPComponents();
  }, [refreshAllCDPComponents]);

  const handleQuickMintSuccess = useCallback(async () => {
    await refreshAllCDPComponents();
  }, [refreshAllCDPComponents]);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Borrow" />

        <main className="p-4 md:p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-3 md:mb-4 h-auto">
              <TabsTrigger value="vaults" className="text-xs md:text-sm py-2 px-1 md:px-3">
                Vaults
              </TabsTrigger>
              <TabsTrigger value="bad-debt" className="text-xs md:text-sm py-2 px-1 md:px-3">
                Bad Debt
              </TabsTrigger>
              <TabsTrigger value="liquidations" className="text-xs md:text-sm py-2 px-1 md:px-3">
                Liquidations
              </TabsTrigger>
            </TabsList>
            <TabsContent value="vaults">
              {!isLoggedIn && (
                <GuestSignInBanner message="Sign in to create vaults and mint USDST" />
              )}
              <div className="flex flex-col lg:flex-row gap-6">
                <div className={isLoggedIn ? "w-full lg:w-[60%]" : "w-full"}>
                  <Mint
                    onSuccess={handleQuickMintSuccess}
                    refreshTrigger={mintPlannerRefreshTrigger}
                    guestMode={!isLoggedIn}
                  />
                </div>
                {isLoggedIn && (
                  <div className="w-full lg:w-[40%] space-y-6">
                    <DebtPosition refreshTrigger={vaultsRefreshTrigger} />
                    <VaultsList
                      refreshTrigger={vaultsRefreshTrigger}
                      onVaultActionSuccess={handleVaultActionSuccess}
                    />
                  </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="bad-debt">
              <BadDebtView guestMode={!isLoggedIn} />
            </TabsContent>
            <TabsContent value="liquidations">
              {!isLoggedIn && (
                <GuestSignInBanner message="Sign in to view and liquidate CDP positions" />
              )}
              <LiquidationsView guestMode={!isLoggedIn} />
            </TabsContent>
          </Tabs>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default Borrow;
