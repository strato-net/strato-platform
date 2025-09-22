import { useEffect, useState, useRef } from 'react';
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
import { useUserTokens } from '@/context/UserTokensContext';
import { useLendingContext } from '@/context/LendingContext';
import { formatUnits } from 'viem';
import { formatUnits as formatUnitsEthers } from 'ethers';
import { useCDP } from '@/context/CDPContext';
import { useSwapContext } from '@/context/SwapContext';
import { useNetBalance } from '@/hooks/useNetBalance';
import AssetsList from '@/components/dashboard/AssetsList';
import ExchangeCart from './ExchangeCart';
import { useSearchParams } from 'react-router-dom';

const DepositsPage = () => {
  const { userAddress } = useUser();
  const { activeTokens: tokens, inactiveTokens, allActiveTokens, loading, allActiveLoading, fetchTokens, fetchAllActiveTokens, fetchUsdstBalance } = useUserTokens();
  const { loans, liquidityInfo } = useLendingContext();
  const { totalCDPDebt } = useCDP();
  const { userPools } = useSwapContext();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  
  // Use centralized net balance calculation hook
  const { netBalance: totalBalance } = useNetBalance({
    tokens,
    loans,
    liquidityInfo,
    totalCDPDebt
  });
  const [searchParams] = useSearchParams();

  const initialTab = searchParams.get('tab') === 'convert' ? 'usdc' : undefined;

  // Add visibility state to prevent flashing
  const [isComponentMounted, setIsComponentMounted] = useState(false);

  // Handle vault action success with debounced refresh
  const handleVaultActionSuccess = () => {
    // Use a longer delay to ensure transaction is processed and tab state is preserved
    setTimeout(() => {
      fetchTokens();
      if (userAddress) {
        fetchUsdstBalance(userAddress);
      }
    }, 1000); // Longer delay to ensure smooth UX
  };

  useEffect(() => {
    // Set mounted state immediately to prevent flash
    setIsComponentMounted(true);
    
    // Fetch data
    fetchTokens();
    fetchAllActiveTokens();
  }, [userAddress, fetchTokens, fetchAllActiveTokens]);

  // Net balance calculation is now handled by the useNetBalance hook above

  // Don't render anything until component is properly mounted
  if (!isComponentMounted) {
    return null;
  }

  // Show loading state while data is being fetched
  if (loading || allActiveLoading) {
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
                  value={`$${totalBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
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
                tokens={tokens} 
                inActiveTokens={inactiveTokens} 
                isDashboard={false}
                shouldPreventFlash={true}
              />
            </div>
          </div>
          {/* Assets List */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Available Assets</CardTitle>
            </CardHeader>
            <CardContent>
              <AssetsGrid loading={allActiveLoading} assets={allActiveTokens} />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default DepositsPage;
