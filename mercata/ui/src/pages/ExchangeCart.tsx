import React, { useState } from 'react';
import CDPMintWidget from '@/components/cdp/MintWidget';
import VaultsList from '@/components/cdp/VaultsList';
import LiquidationsView from '@/components/cdp/LiquidationsView';
import BadDebtView from '@/components/cdp/BadDebtView';
import BridgeWidget from '@/components/bridge/BridgeWidget';
import SwapWidget from '@/components/swap/SwapWidget';
import MintWidget from '../components/mint/MintWidget'; // Bridge deposit widget
import WithdrawWidget from '../components/mint/WithdrawWidget';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Tabs as AntdTabs } from 'antd';
import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBridgeContext } from '@/context/BridgeContext';
import { useCDP } from '@/context/CDPContext';

interface ExchangeCartProps {
  onVaultActionSuccess?: () => void; // Callback passed from parent
  initialTab?: string; // Initial tab to open
}

const ExchangeCart: React.FC<ExchangeCartProps> = ({ onVaultActionSuccess, initialTab }) => {
  const [usdcActiveTab, setUsdcActiveTab] = useState('deposit');
  const [mintActiveTab, setMintActiveTab] = useState('vaults');
  // Use localStorage to persist tab state across re-renders, but prioritize initialTab if provided
  const [activeTab, setActiveTab] = useState(() => {
    // If initialTab is provided, use it instead of localStorage
    if (initialTab) {
      return initialTab;
    }
    try {
      return localStorage.getItem('exchangeCart-activeTab') || 'usdc';
    } catch {
      return 'usdc';
    }
  });
  const navigate = useNavigate();
  const { setTargetTransactionTab } = useBridgeContext();
  const { refreshVaults } = useCDP();
  const [convertAction, setConvertAction] = useState<'deposit' | 'withdraw' | null>(null);
  const [vaultsRefreshTrigger, setVaultsRefreshTrigger] = useState(0);

  // Callback to refresh vaults when mint operation succeeds
  const handleMintSuccess = () => {
    setVaultsRefreshTrigger(prev => prev + 1);
    // Also refresh deposits when minting succeeds
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

  const handleVaultActionSuccess = () => {
    refreshVaults();
    if (onVaultActionSuccess) {
      onVaultActionSuccess();
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
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="cdp">Mint</TabsTrigger>
          <TabsTrigger value="bridge">Bridge</TabsTrigger>
          <TabsTrigger value="swap">Swap</TabsTrigger>
          <TabsTrigger value="usdc">Convert</TabsTrigger>
        </TabsList>
        
        <TabsContent value="cdp">
          <div className="w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Mint</h2>
            </div>
            <div className="w-full bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm">
              <AntdTabs
                activeKey={mintActiveTab}
                items={[
                  {
                    key: 'vaults',
                    label: 'Vaults',
                  },
                  {
                    key: 'bad-debt',
                    label: 'Bad Debt',
                  },
                  {
                    key: 'liquidations',
                    label: 'Liquidations',
                  },
                ]}
                onChange={(value) => setMintActiveTab(value)}
                className="custom-tabs"
                style={{
                  '--ant-primary-color': '#3b82f6',
                  '--ant-primary-color-hover': '#2563eb',
                } as React.CSSProperties}
              />
              <div className="bg-white rounded-xl p-4 shadow-sm mt-4">
                {mintActiveTab === 'vaults' ? (
                  <div className="space-y-6">
                    <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
                      <CDPMintWidget onSuccess={handleMintSuccess} />
                    </div>
                    <VaultsList 
                      refreshTrigger={vaultsRefreshTrigger} 
                      onVaultActionSuccess={handleVaultActionSuccess}
                    />
                  </div>
                ) : mintActiveTab === 'bad-debt' ? (
                  <div>
                    <BadDebtView />
                  </div>
                ) : (
                  <div>
                    <LiquidationsView />
                  </div>
                )}
              </div>
            </div>
          </div>
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
              <h2 className="text-lg font-semibold text-gray-900">USDST</h2>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-2"
                onClick={() => {
                  // Set the target tab based on the current USDC active tab
                  const targetTab = usdcActiveTab === 'deposit' ? 'USDSTDeposit' : 'RedemptionInitiated';
                  setTargetTransactionTab(targetTab);
                  navigate("/dashboard/bridge-transactions");
                }}
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
                      <h3 className="text-lg font-semibold text-center">Get USDST</h3>
                      <p className="text-sm text-gray-600 text-center">Bridge stablecoins and get USDST</p>
                    </div>
                    <MintWidget />
                  </div>
                ) : (
                  <div>
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-center">Redeem to Stablecoins</h3>
                      <p className="text-sm text-gray-600 text-center">Redeem USDST back to external stablecoins</p>
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