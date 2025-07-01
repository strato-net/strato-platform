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

const Assets = () => {
  const { userAddress } = useUser()
  const { tokens, loading, fetchTokens } = useUserTokens()
  const [totalBalance, setTotalBalance] = useState<number>(0)

  useEffect(()=>{
    fetchTokens(userAddress)
  },[userAddress])

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
        <DashboardHeader title="Assets" />
        
        <main className="p-6">
          {/* Asset Summary */}

          <div className="mb-8">
            <AssetsList loading={loading} tokens={tokens} />
          </div>

          <div className="mb-8">
            <AssetSummary 
              title="Total Assets" 
              value={formatBalance(totalBalance)}
              change={4.2}
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
              <AssetsGrid loading={loading} assets={tokens} />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default Assets;
