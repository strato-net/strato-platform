import { useEffect, useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileBottomNav from '../components/dashboard/MobileBottomNav';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AssetSummary from '@/components/dashboard/AssetSummary';
import { Wallet } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useTokenContext } from '@/context/TokenContext';
import { useLendingContext } from '@/context/LendingContext';
import { useCDP } from '@/context/CDPContext';
import { useNetBalance } from '@/hooks/useNetBalance';
import AssetsList from '@/components/dashboard/AssetsList';
import BridgeIn from '@/components/bridge/BridgeIn';
import { useBridgeContext } from '@/context/BridgeContext';
// import DepositTransactionDetails from '@/components/dashboard/DepositTransactionDetails';
import { cataAddress } from '@/lib/constants';

const DepositsPage = () => {
  const location = useLocation();
  const { userAddress } = useUser();
  const { earningAssets, getEarningAssets, inactiveTokens, loadingEarningAssets } = useTokenContext();
  const { loans } = useLendingContext();
  const { totalCDPDebt } = useCDP();
  const { loadNetworksAndTokens } = useBridgeContext();
  const [activeTab, setActiveTab] = useState<"easy-savings" | "bridge-in">("easy-savings");

  const cataToken = inactiveTokens?.find(token => token.address === cataAddress);

  const { nonPoolTokens } = useMemo(() => {
    const sorted = [...earningAssets].sort((a, b) => parseFloat(b.value || "0") - parseFloat(a.value || "0"));
    return { nonPoolTokens: sorted.filter(token => !token.isPoolToken) };
  }, [earningAssets]);

  const { netBalance: totalBalance, isLoading: isLoadingNetBalance } = useNetBalance({
    tokens: earningAssets,
    cataToken,
    loans,
    totalCDPDebt
  });

  useEffect(() => {
    getEarningAssets(earningAssets.length === 0);
    loadNetworksAndTokens().catch(console.error);
  }, [location.pathname, userAddress]);

  return (
    <div className="h-screen bg-background overflow-hidden">
      <DashboardSidebar />
      <div className="h-screen flex flex-col transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Deposits" />
        <main className="flex-1 p-4 md:p-6 overflow-y-auto pb-20 md:pb-6">
          <div className="flex flex-col lg:flex-row gap-4 md:gap-6">
            {/* Left Column - Deposit Form */}
            <div className="w-full lg:w-1/2">
              <Card className="shadow-sm rounded-xl">
                <CardContent className="pt-6">
                  {/* Tabs */}
                  <div className="flex border-b border-border mb-6">
                    <button
                      onClick={() => setActiveTab("easy-savings")}
                      className={`flex-1 py-2.5 px-4 text-sm font-medium transition-colors border-b-2 ${
                        activeTab === "easy-savings"
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Easy Saving
                    </button>
                    <button
                      onClick={() => setActiveTab("bridge-in")}
                      className={`flex-1 py-2.5 px-4 text-sm font-medium transition-colors border-b-2 ${
                        activeTab === "bridge-in"
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Bridge In
                    </button>
                  </div>
                  <BridgeIn isSaving={activeTab === "easy-savings"} />
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Balance & My Deposits */}
            <div className="w-full lg:w-1/2 flex flex-col gap-4 md:gap-6">
              <AssetSummary
                title="Net Balance"
                value={`$${totalBalance.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`}
                icon={<Wallet className="text-white" size={18} />}
                color="bg-blue-500"
                isLoading={isLoadingNetBalance}
              />
              <Card className="shadow-sm rounded-xl flex-1">
                <CardHeader>
                  <CardTitle className="text-lg font-bold">My Deposits</CardTitle>
                </CardHeader>
                <CardContent>
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

          {/* Deposit History - Commented for now */}
          {/* <Card className="shadow-sm rounded-xl mt-4 md:mt-6">
            <CardHeader>
              <CardTitle className="text-lg font-bold">Deposit History</CardTitle>
            </CardHeader>
            <CardContent>
              <DepositTransactionDetails context="deposits" />
            </CardContent>
          </Card> */}
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
};

export default DepositsPage;
