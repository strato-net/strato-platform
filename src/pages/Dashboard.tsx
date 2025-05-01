
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import AssetSummary from '../components/dashboard/AssetSummary';
import AssetsList from '../components/dashboard/AssetsList';
import DashboardFAQ from '../components/dashboard/DashboardFAQ';
import BorrowingSection from '../components/dashboard/BorrowingSection';
import { Wallet, Coins, ChartBar, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';

const Dashboard = () => {
  useEffect(() => {
    document.title = "Dashboard | STRATO Mercata";
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />
      
      <div className="flex-1 ml-64">
        <DashboardHeader title="Overview" />
        
        <main className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <AssetSummary 
              title="Total Balance" 
              value="$4,327.39"
              change={2.5}
              icon={<Wallet className="text-white" size={18} />}
              color="bg-blue-500"
            />
            
            <AssetSummary 
              title="CATA Rewards" 
              value="287.53 CATA"
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
              value="$1,250.00"
              change={0}
              icon={<Shield className="text-white" size={18} />}
              color="bg-orange-500"
            />
          </div>

          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Your Assets</h2>
              <Link to="/dashboard/assets">
                <Button variant="outline" className="flex gap-2">
                  Add Deposit
                </Button>
              </Link>
            </div>
            <AssetsList />
          </div>
          
          <div className="mb-8">
            <BorrowingSection />
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
