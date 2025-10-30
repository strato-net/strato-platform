import React from 'react';
import BridgeTransactionsComponent from '../components/dashboard/BridgeTransactionsPage';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import DashboardHeader from '@/components/dashboard/DashboardHeader';

const BridgeTransactionsPage = () => {
  const navigate = useNavigate();

  return (
    <div className="h-screen bg-gray-50">
      <DashboardSidebar />
      <div className="flex flex-col transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 16rem)', height: '100vh' }}>
        <DashboardHeader title="Bridge Transactions" />
        <div className="flex-1 p-8">
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
              className="absolute -left-4 top-0 rounded-full hover:bg-gray-100 w-10 h-10 border border-gray-200 shadow-sm"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <BridgeTransactionsComponent isOpen={true} onClose={() => {}} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BridgeTransactionsPage; 