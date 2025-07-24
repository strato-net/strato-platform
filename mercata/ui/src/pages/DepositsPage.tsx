import { useEffect, useState } from 'react';
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
import AssetsList from '@/components/dashboard/AssetsList';
import ExchangeCart from './ExchangeCart';

const DepositsPage = () => {
  const { userAddress } = useUser();
  const { activeTokens: tokens, inactiveTokens, allActiveTokens, loading, allActiveLoading, fetchTokens, fetchAllActiveTokens } = useUserTokens();
  const { loans } = useLendingContext();
  const [totalBalance, setTotalBalance] = useState<number>(0);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    fetchTokens();
    fetchAllActiveTokens();
  }, [userAddress]);

  useEffect(() => {
    if (!tokens || tokens.length === 0) return;

    let total = 0;

    for (let i = 0; i < tokens.length; i++) {

      const token = tokens[i];
      const rawPrice = token?.price || "0";
      const rawBalance = token?.balance || "0";
      const rawCollateralBalance = token?.collateralBalance || "0";

      const price = parseFloat(formatUnits(BigInt(rawPrice), 18));
      const balance = parseFloat(formatUnits(BigInt(rawBalance), 18));
      const collateralBalance = parseFloat(formatUnits(BigInt(rawCollateralBalance), 18));

      // Calculate total value including both balance and collateral
      const totalTokenValue = (balance + collateralBalance) * price;
      total += totalTokenValue;
    }

    // Get USDST borrowed from loans data
    const usdstBorrowed = loans?.totalAmountOwed 
      ? parseFloat(formatUnits(BigInt(loans.totalAmountOwed), 18))
      : 0;

    // Net Balance = All deposits (including supplied) - USDST Borrowed
    const netBalance = total - usdstBorrowed;
    setTotalBalance(netBalance);
  }, [tokens, loans]);

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
              <ExchangeCart />
            </div>
            <div className="flex-1 min-w-0 max-w-full">
              <AssetsList loading={loading} tokens={tokens} inActiveTokens={inactiveTokens} isDashboard={false} />
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
