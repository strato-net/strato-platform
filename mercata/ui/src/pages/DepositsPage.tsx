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
import AssetsGrid from '@/components/dashboard/AssetsGrid';
import { Wallet, ExternalLink } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useTokenContext } from '@/context/TokenContext';
import { useLendingContext } from '@/context/LendingContext';
import { useCDP } from '@/context/CDPContext';
import { useNetBalance } from '@/hooks/useNetBalance';
import AssetsList from '@/components/dashboard/AssetsList';
import BridgeIn from '@/components/bridge/BridgeIn';
import { useBridgeContext } from '@/context/BridgeContext';
import { cataAddress } from '@/lib/constants';

const DepositsPage = () => {
  const location = useLocation();
  const { userAddress } = useUser();
  const { earningAssets, getEarningAssets, inactiveTokens, loadingEarningAssets } = useTokenContext();
  const { loans } = useLendingContext();
  const { totalCDPDebt } = useCDP();
  const { loadNetworksAndTokens, setTargetTransactionTab } = useBridgeContext();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"convert" | "bridge-in">("convert");

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
  const { netBalance: totalBalance } = useNetBalance({
    tokens: earningAssets,
    cataToken,
    loans,
    totalCDPDebt
  });

  useEffect(() => {
    const hasExistingEarningAssets = earningAssets.length > 0;
    
    getEarningAssets(!hasExistingEarningAssets);
    loadNetworksAndTokens().catch(() => {});
  }, [location.pathname, userAddress]);

  return (
    <div className="h-screen bg-gray-50 overflow-hidden">
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
            }
          `}</style>
          <div className="mb-8 flex flex-col lg:flex-row gap-6 items-start">
            <div className="w-full lg:w-[40%] lg:min-w-[400px] lg:max-w-[600px] lg:sticky lg:top-0">
              <Card className="shadow-sm">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Deposit Assets</CardTitle>
                    <Link
                      to="/bridge-transactions"
                      onClick={() => setTargetTransactionTab('DepositRecorded')}
                      className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      <ExternalLink size={16} />
                      View Transactions
                    </Link>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="w-full bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm">
                  <AntdTabs
                    activeKey={activeTab}
                    items={[
                      {
                        key: "convert",
                        label: "Convert",
                      },
                      {
                        key: "bridge-in",
                        label: "Bridge In",
                      },
                    ]}
                    onChange={(value) =>
                      setActiveTab(value as "convert" | "bridge-in")
                    }
                    className="custom-tabs"
                    style={
                      {
                        "--ant-primary-color": "#3b82f6",
                        "--ant-primary-color-hover": "#2563eb",
                      } as React.CSSProperties
                    }
                  />
                    <div className="bg-white rounded-xl p-4 shadow-sm mt-4">
                      <BridgeIn isConvert={activeTab === "convert"} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="flex-1 min-w-0 max-w-full">
              {/* Net Balance moved to right column */}
              <div className="mb-6">
                <AssetSummary 
                  title="Net Balance" 
                  value={`$${totalBalance.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`}
                  icon={<Wallet className="text-white" size={18} />}
                  color="bg-blue-500"
                />
              </div>
              {/* My Deposits (Earning Assets) */}
              <AssetsList 
                loading={loadingEarningAssets} 
                tokens={nonPoolTokens} 
                inActiveTokens={inactiveTokens} 
                isDashboard={false}
              />
            </div>
          </div>
          {/* Assets List */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Available Assets</CardTitle>
            </CardHeader>
            <CardContent>
              <AssetsGrid loading={loadingEarningAssets} assets={sortedEarningAssets} />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default DepositsPage;
