import React, { useState } from 'react';
import CDPBorrowWidget from '@/components/cdp/MintWidget';
import VaultsList from '@/components/cdp/VaultsList';
import LiquidationsView from '@/components/cdp/LiquidationsView';
import BridgeWidget from '@/components/bridge/BridgeWidget';
import SwapWidget from '@/components/swap/SwapWidget';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

interface ExchangeCartProps {
  onVaultActionSuccess?: () => void; // Callback passed from parent
  initialTab?: string; // Initial tab to open
}

const ExchangeCart: React.FC<ExchangeCartProps> = ({ onVaultActionSuccess, initialTab }) => {
  const [showLiquidations, setShowLiquidations] = useState(false);
  // Use localStorage to persist tab state across re-renders, but prioritize initialTab if provided
  const [activeTab, setActiveTab] = useState(() => {
    // If initialTab is provided, use it instead of localStorage
    if (initialTab) {
      return initialTab;
    }
    try {
      return localStorage.getItem('exchangeCart-activeTab') || 'bridge';
    } catch {
      return 'bridge';
    }
  });
  const [vaultsRefreshTrigger, setVaultsRefreshTrigger] = useState(0);

  // Callback to refresh vaults when borrow operation succeeds
  const handleBorrowSuccess = () => {
    setVaultsRefreshTrigger(prev => prev + 1);
    // Also refresh deposits when borrowing succeeds
    if (onVaultActionSuccess) {
      onVaultActionSuccess();
    }
  };

  // Update tab state in localStorage when it changes
  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    try {
      localStorage.setItem('exchangeCart-activeTab', newTab);
    } catch {
      // Ignore localStorage errors
    }
  };

  // Pass the callback from parent to VaultsList - no local refresh logic
  const handleVaultActionSuccess = () => {
    if (onVaultActionSuccess) {
      onVaultActionSuccess();
    }
  };

  return (
    <div className="w-full bg-white shadow-md rounded-2xl p-4 space-y-5 font-sans">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="cdp">Borrow</TabsTrigger>
          <TabsTrigger value="bridge">Bridge</TabsTrigger>
          <TabsTrigger value="swap">Swap</TabsTrigger>
          <TabsTrigger value="convert">Convert</TabsTrigger>
        </TabsList>
        
        <TabsContent value="cdp">
          {showLiquidations ? (
            <LiquidationsView onBack={() => setShowLiquidations(false)} />
          ) : (
            <div className="space-y-6">
              {/* Liquidations Button */}
              <div className="flex justify-end">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowLiquidations(true)}
                  className="text-red-600 border-red-200 hover:bg-red-50"
                >
                  Liquidations
                </Button>
              </div>
              
              <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
                <CDPBorrowWidget onSuccess={handleBorrowSuccess} />
              </div>
              <VaultsList 
                refreshTrigger={vaultsRefreshTrigger} 
                onVaultActionSuccess={handleVaultActionSuccess}
              />
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="bridge">
          <BridgeWidget operation="wrap" />
        </TabsContent>
        
        <TabsContent value="swap">
          <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
            <SwapWidget />
          </div>
        </TabsContent>
        
        <TabsContent value="convert">
          <BridgeWidget operation="mint" />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ExchangeCart; 