import React, { useState } from 'react';
import CDPBorrowWidget from '@/components/cdp/MintWidget';
import VaultsList from '@/components/cdp/VaultsList';
import LiquidationsView from '@/components/cdp/LiquidationsView';
import BridgeWidget from '@/components/bridge/BridgeWidget';
import SwapWidget from '@/components/swap/SwapWidget';
import MintWidget from '../components/mint/MintWidget'; // Bridge deposit widget
import WithdrawWidget from '../components/mint/WithdrawWidget';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Tabs as AntdTabs } from 'antd';
import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";

const ExchangeCart = () => {
  const [showLiquidations, setShowLiquidations] = useState(false);
  const [usdcActiveTab, setUsdcActiveTab] = useState('deposit');
  const navigate = useNavigate();
  const [convertAction, setConvertAction] = useState<'deposit' | 'withdraw' | null>(null);
  const [vaultsRefreshTrigger, setVaultsRefreshTrigger] = useState(0);

  // Callback to refresh vaults when borrow operation succeeds
  const handleBorrowSuccess = () => {
    setVaultsRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="w-full bg-white shadow-md rounded-2xl p-4 space-y-5 font-sans">
      <Tabs defaultValue="bridge" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="cdp">Borrow</TabsTrigger>
          <TabsTrigger value="bridge">Bridge</TabsTrigger>
          <TabsTrigger value="swap">Swap</TabsTrigger>
          <TabsTrigger value="usdc">Convert</TabsTrigger>
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
              <VaultsList refreshTrigger={vaultsRefreshTrigger} />
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="bridge">
          <BridgeWidget />
        </TabsContent>
        
        <TabsContent value="swap">
          <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
            <SwapWidget />
          </div>
        </TabsContent>
        
        <TabsContent value="usdc">
          <div className="w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">USDC/USDT Bridge</h2>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-2"
                onClick={() => navigate("/dashboard/bridge-transactions")}
              >
                <History className="h-4 w-4" />
                View Transactions
              </Button>
            </div>
            <div className="w-full bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm">
              <AntdTabs
                activeKey={usdcActiveTab}
                items={[
                  {
                    key: 'deposit',
                    label: 'Deposit',
                  },
                  {
                    key: 'withdraw',
                    label: 'Withdraw',
                  },
                ]}
                onChange={(value) => setUsdcActiveTab(value)}
                className="custom-tabs"
                style={{
                  '--ant-primary-color': '#3b82f6',
                  '--ant-primary-color-hover': '#2563eb',
                } as React.CSSProperties}
              />
              <div className="bg-white rounded-xl p-4 shadow-sm mt-4">
                {usdcActiveTab === 'deposit' ? (
                  <div>
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-center">Convert to USDST</h3>
                      <p className="text-sm text-gray-600 text-center">Bridge USDC/USDT and mint USDST</p>
                    </div>
                    <MintWidget />
                  </div>
                ) : (
                  <div>
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-center">Redeem to USDC/USDT</h3>
                      <p className="text-sm text-gray-600 text-center">Redeem USDST back to USDC/USDT</p>
                    </div>
                    <WithdrawWidget />
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ExchangeCart; 