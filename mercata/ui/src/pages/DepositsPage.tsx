import { useEffect, useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
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

const DepositsPage = () => {
  const location = useLocation();
  const { userAddress } = useUser();
  const { earningAssets, getEarningAssets, inactiveTokens, loadingEarningAssets } = useTokenContext();
  const { loans } = useLendingContext();
  const { totalCDPDebt } = useCDP();
  const { loadNetworksAndTokens, setTargetTransactionTab } = useBridgeContext();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"easy-savings" | "bridge-in">("easy-savings");

  // Extract CATA token from inactive tokens by address
  const cataToken = inactiveTokens?.find(token =>
    token.address === cataAddress
  );

  // Sort earning assets by value first, then categorize
  const { nonPoolTokens, sortedEarningAssets } = useMemo(() => {
    const sorted = [...earningAssets].sort((a, b) => {
      const valueA = parseFloat(a.value || "0");
      const valueB = parseFloat(b.value || "0");
      return valueB - valueA;
    });
    const nonPool: typeof earningAssets = [];
    for (const token of sorted) {
      if (!token.isPoolToken) {
        nonPool.push(token);
      }
    }
    return { nonPoolTokens: nonPool, sortedEarningAssets: sorted };
  }, [earningAssets]);

  // Use centralized net balance calculation hook
  const { netBalance: totalBalance, isLoading: isLoadingNetBalance } = useNetBalance({
    tokens: earningAssets,
    cataToken,
    loans,
    totalCDPDebt
  });

  useEffect(() => {
    const hasExistingEarningAssets = earningAssets.length > 0;
    
    getEarningAssets(!hasExistingEarningAssets);
    loadNetworksAndTokens().catch((error) => {
      console.error('Failed to load networks and tokens:', error);
    });
  }, [location.pathname, userAddress, getEarningAssets, loadNetworksAndTokens]);

  return (
    <div className="h-screen bg-background overflow-hidden">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="h-screen flex flex-col transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Deposits" onMenuClick={() => setIsMobileSidebarOpen(true)} />
        <main className="flex-1 p-6 overflow-y-auto">
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
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Deposit Assets</CardTitle>
                    <Link
                      to="/bridge-transactions"
                      onClick={() => setTargetTransactionTab('DepositRecorded')}
                      className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      <ArrowRight size={16} />
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
                    <div className="mt-4 flex-1 min-h-0 overflow-auto">
                      <BridgeIn isConvert={activeTab === "easy-savings"} />
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
                  value={`$${totalBalance.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`}
                  icon={<Wallet className="text-white" size={18} />}
                  color="bg-blue-500"
                  isLoading={isLoadingNetBalance}
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
                    inActiveTokens={inactiveTokens} 
                    isDashboard={false}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Deposit History</CardTitle>
            </CardHeader>
            <CardContent>
              <DepositTransactionDetails context="deposits" />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default DepositsPage;
