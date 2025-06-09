import { useEffect } from 'react';
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
import { Coins, ChartBar } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useUserTokens } from '@/context/UserTokensContext';

const Assets = () => {
  const { userAddress } = useUser()
  const { tokens: assets, loading, fetchTokens } = useUserTokens()

  useEffect(()=>{
    fetchTokens(userAddress)
  },[userAddress])

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />
      
      <div className="flex-1 ml-64">
        <DashboardHeader title="Assets" />
        
        <main className="p-6">
          {/* Asset Summary */}
          <div className="mb-8">
            <AssetSummary 
              title="Total Assets" 
              value="$386,787.71"
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
              <AssetsGrid loading={loading} assets={assets} />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default Assets;
