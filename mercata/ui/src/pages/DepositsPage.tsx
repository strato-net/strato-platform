import { useEffect, useState, useMemo } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
import { 
  Card, 
  CardContent,  
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import AssetSummary from '@/components/dashboard/AssetSummary';
import AssetsGrid from '@/components/dashboard/AssetsGrid';
import { Wallet } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useTokenContext } from '@/context/TokenContext';
import { useLendingContext } from '@/context/LendingContext';
import { useCDP } from '@/context/CDPContext';
import { useNetBalance } from '@/hooks/useNetBalance';
import AssetsList from '@/components/dashboard/AssetsList';
import ExchangeCart from './ExchangeCart';
import { useSearchParams } from 'react-router-dom';
import { cataAddress } from '@/lib/constants';

const DepositsPage = () => {
  const { userAddress } = useUser();
  const { earningAssets, getEarningAssets, inactiveTokens, getInactiveTokens, loading } = useTokenContext();
  const { loans, refreshLoans } = useLendingContext();
  const { totalCDPDebt, refreshVaults } = useCDP();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

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
  const [searchParams] = useSearchParams();

  const initialTab = searchParams.get('tab') === 'convert' ? 'usdc' : undefined;

  // Add visibility state to prevent flashing
  const [isComponentMounted, setIsComponentMounted] = useState(false);

  // Handle vault action success with debounced refresh
  const handleVaultActionSuccess = () => {
    setTimeout(() => {
      getEarningAssets();
      getInactiveTokens();
      refreshLoans(); 
      refreshVaults();
    }, 1000);
  };

  useEffect(() => {
    setIsComponentMounted(true);
    getEarningAssets();
    getInactiveTokens();
  }, [userAddress, getEarningAssets, getInactiveTokens]);

  // Net balance calculation is now handled by the useNetBalance hook above

  // Don't render anything until component is properly mounted
  if (!isComponentMounted) {
    return null;
  }

  // Show loading state while data is being fetched
  if (loading) {
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
            <div className="flex justify-center items-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
            </div>
          </main>
        </div>
      </div>
    );
  }

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
          <div className="mb-8 flex flex-col lg:flex-row gap-6 items-start">
            <div className="w-full lg:w-[40%] lg:min-w-[400px] lg:max-w-[600px] lg:sticky lg:top-0">
              {/* Asset Summary */}
              <div className="mb-6">
                <AssetSummary 
                  title="Net Balance" 
                  value={`$${totalBalance.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`}
                  icon={<Wallet className="text-white" size={18} />}
                  color="bg-blue-500"
                />
              </div>
              <ExchangeCart onVaultActionSuccess={handleVaultActionSuccess} initialTab={initialTab} />
            </div>
            <div className="flex-1 min-w-0 max-w-full">
              {/* Render AssetsList when data is loaded */}
              <AssetsList 
                loading={loading} 
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
              <AssetsGrid loading={loading} assets={sortedEarningAssets} />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default DepositsPage;
