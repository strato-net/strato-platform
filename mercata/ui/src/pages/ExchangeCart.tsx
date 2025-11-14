import React, { useEffect, useState } from 'react';
import MintWidget from '../components/mint/MintWidget'; // Bridge deposit widget
import BridgeIn from '@/components/bridge/BridgeIn';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBridgeContext } from '@/context/BridgeContext';

interface ExchangeCartProps {
  onVaultActionSuccess?: () => void; // Callback passed from parent
  initialTab?: string; // Initial tab to open
}

const ExchangeCart: React.FC<ExchangeCartProps> = ({ onVaultActionSuccess, initialTab }) => {
  // Use localStorage to persist tab state across re-renders, but prioritize initialTab if provided
  const [activeTab, setActiveTab] = useState(() => {
    // If initialTab is provided, use it instead of localStorage
    if (initialTab) {
      return initialTab;
    }
    try {
      return localStorage.getItem('exchangeCart-activeTab') || 'easy-saving';
    } catch {
      return 'easy-saving';
    }
  });
  const navigate = useNavigate();
  const { setTargetTransactionTab, loadNetworksAndTokens } = useBridgeContext();

  // Ensure bridge networks/tokens are loaded for Bridge In tab usage
  useEffect(() => {
    loadNetworksAndTokens().catch(() => {});
  }, [loadNetworksAndTokens]);

  // Update tab state in localStorage when it changes
  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    try {
      localStorage.setItem('exchangeCart-activeTab', newTab);
    } catch {
      // Ignore localStorage errors
    }
  };

  return (
    <div className="w-full bg-white shadow-md rounded-2xl p-4 space-y-5 font-sans">
      <style>{`
        .custom-tabs .ant-tabs-tab {
          justify-content: center !important;
        }
        .custom-tabs .ant-tabs-tab-btn {
          justify-content: center !important;
          text-align: center !important;
          width: 100% !important;
        }
      `}</style>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="easy-saving">Easy Saving</TabsTrigger>
          <TabsTrigger value="bridge-in">Bridge In</TabsTrigger>
        </TabsList>

        <TabsContent value="easy-saving">
          <div className="w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">USDST</h2>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-2"
                onClick={() => {
                  setTargetTransactionTab('USDSTDeposit');
                  navigate("/dashboard/bridge-transactions");
                }}
              >
                <History className="h-4 w-4" />
                View Transactions
              </Button>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm mt-4">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-center">Get USDST</h3>
                <p className="text-sm text-gray-600 text-center">Bridge stablecoins and get USDST</p>
              </div>
              <MintWidget />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="bridge-in">
          <div className="w-full bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm">
            <div className="bg-white rounded-xl p-4 shadow-sm mt-4">
              <BridgeIn />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ExchangeCart; 