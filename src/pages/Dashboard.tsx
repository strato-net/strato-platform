
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import AssetSummary from '../components/dashboard/AssetSummary';
import AssetsList from '../components/dashboard/AssetsList';
import DashboardFAQ from '../components/dashboard/DashboardFAQ';
import BorrowingSection from '../components/dashboard/BorrowingSection';
import { Wallet, Coins, ChartBar, Shield } from 'lucide-react';

interface Assets {
  usdst: number;
  goldst: number;
  cata: number;
  borrowed: number;
}

const Dashboard = () => {
  const location = useLocation();
  const [assets, setAssets] = useState<Assets>({
    usdst: 0,
    goldst: 0,
    cata: 0,
    borrowed: 0
  });

  useEffect(() => {
    document.title = "Dashboard | STRATO Mercata";
    
    // Get assets data from location state if available
    if (location.state?.assets) {
      setAssets(location.state.assets);
    }
  }, [location.state]);

  // Calculate total balance (USDST + value of GOLDST)
  const goldstValue = assets.goldst * 1958.30; // Using the price from AssetsList
  const totalBalance = assets.usdst + goldstValue;
  
  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />
      
      <div className="flex-1 ml-64">
        <DashboardHeader title="Overview" />
        
        <main className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <AssetSummary 
              title="Total Balance" 
              value={`$${totalBalance.toFixed(2)}`}
              change={2.5}
              icon={<Wallet className="text-white" size={18} />}
              color="bg-blue-500"
            />
            
            <AssetSummary 
              title="CATA Rewards" 
              value={`${assets.cata.toFixed(2)} CATA`}
              change={12.3}
              icon={<Coins className="text-white" size={18} />}
              color="bg-purple-500"
            />
            
            <AssetSummary 
              title="Portfolio Growth" 
              value="8.4%"
              change={3.7}
              icon={<ChartBar className="text-white" size={18} />}
              color="bg-green-500"
            />
            
            <AssetSummary 
              title="Borrowing" 
              value={`$${assets.borrowed.toFixed(2)}`}
              change={0}
              icon={<Shield className="text-white" size={18} />}
              color="bg-orange-500"
            />
          </div>

          <div className="mb-8">
            <AssetsList userAssets={assets} />
          </div>
          
          <div className="mb-8">
            <BorrowingSection borrowed={assets.borrowed} />
          </div>

          <div className="mb-8">
            <DashboardFAQ />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
