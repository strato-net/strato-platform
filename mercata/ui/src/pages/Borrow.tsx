import { useState, useCallback, useMemo } from "react";
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
import Loop from "./Loop";

const BORROW_ACTIVE_TAB_KEY = "borrow_active_tab_v1";
const BORROW_TABS = ['vaults', 'bad-debt', 'liquidations', 'loop'] as const;
type BorrowTab = typeof BORROW_TABS[number];

const isBorrowTab = (value: string | null): value is BorrowTab => {
  return value !== null && BORROW_TABS.includes(value as BorrowTab);
};

const getStoredBorrowTab = (): BorrowTab | null => {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(BORROW_ACTIVE_TAB_KEY);
  return isBorrowTab(value) ? value : null;
};

const Borrow = () => {
  const { isLoggedIn } = useUser();
  const { refreshVaults } = useCDP();
  const { refetch: refetchRewards } = useRewardsUserInfo();
  const { fetchTokens } = useUserTokens();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<BorrowTab>(() => {
    const subtabParam = searchParams.get("subtab");
    if (isBorrowTab(subtabParam)) return subtabParam;
    return getStoredBorrowTab() || "vaults";
  });
  const [vaultsRefreshTrigger, setVaultsRefreshTrigger] = useState(0);
  const [mintPlannerRefreshTrigger, setMintPlannerRefreshTrigger] = useState(0);

  if (typeof document !== "undefined" && document.title !== "Borrow | STRATO") {
    document.title = "Borrow | STRATO";
  }

  const resolvedActiveTab = useMemo<BorrowTab>(() => {
    const subtabParam = searchParams.get("subtab");
    if (isBorrowTab(subtabParam)) return subtabParam;
    return activeTab;
  }, [activeTab, searchParams]);

  const handleTabChange = useCallback((nextTab: string) => {
    if (!isBorrowTab(nextTab)) return;
    setActiveTab(nextTab);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(BORROW_ACTIVE_TAB_KEY, nextTab);
    }
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === "vaults") {
      nextParams.delete("subtab");
    } else {
      nextParams.set("subtab", nextTab);
    }
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

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
          <Tabs
            value={resolvedActiveTab}
            onValueChange={handleTabChange}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-4 mb-3 md:mb-4 h-auto">
              <TabsTrigger value="vaults" className="text-xs md:text-sm py-2 px-1 md:px-3 transition-colors hover:bg-muted/70 hover:text-foreground">
                Vaults
              </TabsTrigger>
              <TabsTrigger value="bad-debt" className="text-xs md:text-sm py-2 px-1 md:px-3 transition-colors hover:bg-muted/70 hover:text-foreground">
                Bad Debt
              </TabsTrigger>
              <TabsTrigger value="liquidations" className="text-xs md:text-sm py-2 px-1 md:px-3 transition-colors hover:bg-muted/70 hover:text-foreground">
                Liquidations
              </TabsTrigger>
              <TabsTrigger value="loop" className="text-xs md:text-sm py-2 px-1 md:px-3 transition-colors hover:bg-muted/70 hover:text-foreground">
                Loop
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
            <TabsContent value="loop">
              <Loop embedded />
            </TabsContent>
          </Tabs>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default Borrow;
