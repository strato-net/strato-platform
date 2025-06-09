import React from 'react';
import BridgeTransactionsComponent from '../components/dashboard/BridgeTransactionsPage';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const BridgeTransactionsPage = () => {
  const navigate = useNavigate();

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="fixed top-4 left-4 z-50">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          className="rounded-full hover:bg-gray-100 w-10 h-10 border border-gray-200 shadow-sm"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      </div>
      <BridgeTransactionsComponent isOpen={true} onClose={() => {}} />
    </div>
  );
};

export default BridgeTransactionsPage; 