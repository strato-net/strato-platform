import { useEffect, useState } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import { 
  Card, 
  CardContent,  
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import AssetSummary from '@/components/dashboard/AssetSummary';
import AssetsGrid from '@/components/dashboard/AssetsGrid';
import { Coins } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { formatUnits } from 'ethers';
import AssetsList from '@/components/dashboard/AssetsList';
import ExchangeCart from './ExchangeCart';

const Assets = () => {
  const { userAddress } = useUser();
  const { activeTokens: tokens, inactiveTokens, allActiveTokens, loading, allActiveLoading, fetchTokens, fetchAllActiveTokens } = useUserTokens();
  const [totalBalance, setTotalBalance] = useState<number>(0)

  useEffect(() => {
    if (userAddress) {
      fetchTokens(userAddress);
      fetchAllActiveTokens();
    }
  }, [userAddress]);

  useEffect(() => {
    if (!tokens || tokens.length === 0) return;

    let total = 0;

    for (let i = 0; i < tokens.length; i++) {

      const token = tokens[i];
      const rawPrice = token?.price || "0";
      const rawBalance = token?.balance || "0";

      const price = parseFloat(formatUnits(BigInt(rawPrice), 18));
      const balance = parseFloat(formatUnits(BigInt(rawBalance), 18));

      const tokenValue = balance * price;
      total += tokenValue;
    }
    setTotalBalance(total);
  }, [tokens]);

  function formatBalance(value: number): string {
    if (typeof value !== "number" || isNaN(value) || !isFinite(value)) return "0.00";
    return value.toLocaleString("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />
      <div className="flex-1 ml-64">
        <DashboardHeader title="Deposits" />
        <main className="p-6">
          {/* Asset Summary */}
          <div className="mb-8 flex gap-6 items-stretch">
            <div className="flex-1 max-w-[700px]">
              <AssetsList loading={loading} tokens={tokens} inActiveTokens={inactiveTokens} isDashboard={false} />
            </div>
            <ExchangeCart />
          </div>
          <div className="mb-8">
            <AssetSummary 
              title="Total Assets" 
              value={formatBalance(totalBalance)}
              icon={<Coins className="text-white" size={18} />}
              color="bg-purple-500"
            />
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

export default Assets;
