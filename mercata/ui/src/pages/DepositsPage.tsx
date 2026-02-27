import { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import PageMeta from '@/components/PageMeta';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileBottomNav from '../components/dashboard/MobileBottomNav';
import { 
  Card, 
  CardContent,  
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Tabs as AntdTabs } from "antd";
import AssetSummary from '@/components/dashboard/AssetSummary';
import { Wallet, ArrowRight } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useTokenContext } from '@/context/TokenContext';
import { useLendingContext } from '@/context/LendingContext';
import { useCDP } from '@/context/CDPContext';
import { useNetBalance } from '@/hooks/useNetBalance';
import AssetsList from '@/components/dashboard/AssetsList';
import BridgeIn from '@/components/bridge/BridgeIn';
import { useBridgeContext } from '@/context/BridgeContext';
import DepositTransactionDetails from '@/components/dashboard/DepositTransactionDetails';
import { cataAddress } from '@/lib/constants';
import GuestSignInBanner from '@/components/ui/GuestSignInBanner';

const DepositsPage = () => {
  const [searchParams] = useSearchParams();
  const { isLoggedIn } = useUser();
  const { earningAssets, inactiveTokens, loadingEarningAssets } = useTokenContext();
  const { loans } = useLendingContext();
  const { totalCDPDebt } = useCDP();
  const { loadNetworksAndTokens, setTargetTransactionTab } = useBridgeContext();
  const [activeTab, setActiveTab] = useState<"easy-savings" | "bridge-in">("easy-savings");

  // Handle query parameters for tab navigation from rewards page
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['easy-savings', 'bridge-in'].includes(tabParam)) {
      setActiveTab(tabParam as "easy-savings" | "bridge-in");
    }
  }, [searchParams]);

  // Extract CATA token from inactive tokens by address
  const cataToken = inactiveTokens?.find(token =>
    token.address === cataAddress
  );

  // Sort earning assets by value first, then filter non-pool tokens
  const nonPoolTokens = useMemo(() => {
    const sorted = [...earningAssets].sort((a, b) => {
      const valueA = parseFloat(a.value || "0");
      const valueB = parseFloat(b.value || "0");
      return valueB - valueA;
    });
    return sorted.filter(token => !token.isPoolToken);
  }, [earningAssets]);

  // Use centralized net balance calculation hook
  const { netBalance: totalBalance, isLoading: isLoadingNetBalance } = useNetBalance({
    tokens: earningAssets,
    cataToken,
    loans,
    totalCDPDebt
  });

  // Load networks and tokens for bridge once on mount (public data)
  useEffect(() => {
    loadNetworksAndTokens().catch((error) => {
      console.error('Failed to load networks and tokens:', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen bg-background overflow-hidden pb-16 md:pb-0">
      <PageMeta
        title="Deposits | STRATO"
        description="Deposit and earn on vaulted gold, silver, and crypto. Bridge assets in or use Easy Savings to start earning instantly."
      />
      <DashboardSidebar />

      <div className="h-screen flex flex-col transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Deposits" />
        <main className="flex-1 p-4 md:p-6 pb-16 md:pb-6 overflow-y-auto">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to deposit and start earning" />
          )}
          <style>{`
            .custom-tabs .ant-tabs-tab {
              justify-content: center !important;
            }
            .custom-tabs .ant-tabs-tab-btn {
              justify-content: center !important;
              text-align: center !important;
              width: 100% !important;
              color: hsl(var(--muted-foreground)) !important;
            }
            .custom-tabs .ant-tabs-tab-active .ant-tabs-tab-btn {
              color: hsl(var(--primary)) !important;
              text-shadow: none !important;
            }
            .custom-tabs .ant-tabs-ink-bar {
              background: hsl(var(--primary)) !important;
            }
          `}</style>
          <div className="mb-8 flex flex-col lg:flex-row gap-6 items-stretch">
            <div className="w-full lg:w-[50%] flex">
              <Card className="shadow-sm flex-1 flex flex-col">
                <CardHeader className="pb-2 md:pb-4">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base md:text-xl">Deposit Assets</CardTitle>
                    <Link
                      to="/bridge-transactions?from=deposits"
                      onClick={(e) => {
                        if (!isLoggedIn) {
                          e.preventDefault();
                          return;
                        }
                        setTargetTransactionTab('DepositRecorded');
                      }}
                      className={`flex items-center gap-1 text-xs md:text-sm font-semibold transition-colors whitespace-nowrap ${
                        isLoggedIn 
                          ? "text-blue-600 hover:text-blue-800 cursor-pointer" 
                          : "text-muted-foreground cursor-not-allowed opacity-50 pointer-events-none"
                      }`}
                    >
                      <ArrowRight size={14} className="md:w-4 md:h-4" />
                      View Transactions
                    </Link>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col min-h-0">
                  <div className="w-full flex-1 flex flex-col min-h-0">
                  <AntdTabs
                    activeKey={activeTab}
                    items={[
                      {
                        key: "easy-savings",
                        label: "Easy Savings",
                      },
                      {
                        key: "bridge-in",
                        label: "Bridge In",
                      },
                    ]}
                    onChange={(value) =>
                      setActiveTab(value as "easy-savings" | "bridge-in")
                    }
                    className="custom-tabs"
                    style={
                      {
                        "--ant-primary-color": "hsl(var(--primary))",
                        "--ant-primary-color-hover": "hsl(var(--primary))",
                      } as React.CSSProperties
                    }
                  />
                    <div className="mt-4 flex-1 min-h-0 overflow-auto p-1 -m-1">
                      <BridgeIn isSaving={activeTab === "easy-savings"} guestMode={!isLoggedIn} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="w-full lg:w-[50%] flex flex-col gap-6">
              {/* Net Balance moved to right column */}
              <div className="flex-[0.5] flex">
                <AssetSummary
                  title="Net Balance"
                  value={isLoggedIn ? `$${totalBalance.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : "-"}
                  icon={<Wallet className="text-white" size={18} />}
                  color="bg-blue-500"
                  isLoading={isLoggedIn && isLoadingNetBalance}
                />
              </div>
              {/* My Deposits (Earning Assets) */}
              <Card className="shadow-sm flex-[4.5] flex flex-col min-h-0">
                <CardHeader>
                  <CardTitle>My Deposits</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 min-h-0 overflow-auto">
                  <AssetsList 
                    loading={loadingEarningAssets} 
                    tokens={nonPoolTokens} 
                    inActiveTokens={isLoggedIn ? inactiveTokens : []} 
                    isDashboard={false}
                    guestMode={!isLoggedIn}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
          {/* Deposit History - hidden on mobile and for guests */}
          {isLoggedIn && (
          <Card className="shadow-sm hidden md:block">
            <CardHeader>
              <CardTitle>Deposit History</CardTitle>
            </CardHeader>
            <CardContent>
              <DepositTransactionDetails context="deposits" />
            </CardContent>
          </Card>
          )}
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default DepositsPage;
