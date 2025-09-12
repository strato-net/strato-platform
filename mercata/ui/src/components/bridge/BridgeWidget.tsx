import React, { useState, useEffect } from 'react';
import { Tabs } from 'antd';
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBridgeContext } from "@/context/BridgeContext";
import BridgeOperation from './BridgeOperation';

interface BridgeWidgetProps {
  operation?: 'wrap' | 'mint';
}

const BridgeWidget: React.FC<BridgeWidgetProps> = ({ 
  operation = 'wrap'
}) => {
  // Determine initial tab and operation based on props
  const getInitialTab = () => {
    switch (operation) {
      case 'mint': return 'bridgeMint';
      default: return 'bridgeIn';
    }
  };

  const [activeTab, setActiveTab] = useState(getInitialTab());
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { loadNetworksAndTokens, setTargetTransactionTab } = useBridgeContext();

  // Load networks on component mount
  useEffect(() => {
    const initializeBridge = async () => {
      try {
        setLoading(true);
        await loadNetworksAndTokens();
      } catch (error) {
        console.error('Error initializing bridge:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeBridge();
  }, [loadNetworksAndTokens]);

  if (loading) {
    return (
      <div className="w-full flex items-center justify-center py-8">
        <div className="text-gray-500">Loading bridge configuration...</div>
      </div>
    );
  }

  // Get dynamic tab configuration based on operation
  const getTabConfig = () => {
    switch (operation) {
      case 'mint':
        return [
          { key: 'bridgeMint', label: 'Deposit' },
          { key: 'bridgeBurn', label: 'Withdraw' }
        ];
      default:
        return [
          { key: 'bridgeIn', label: 'Bridge In' },
          { key: 'bridgeOut', label: 'Bridge Out' }
        ];
    }
  };

  // Get the bridge operation based on active tab
  const getBridgeOperation = () => {
    switch (activeTab) {
      case 'bridgeIn': return 'bridgeWrap';
      case 'bridgeOut': return 'bridgeUnwrap';
      case 'bridgeMint': return 'bridgeMint';
      case 'bridgeBurn': return 'bridgeBurn';
      default: return 'bridgeWrap';
    }
  };

  // Get target transaction tab for navigation
  const getTargetTransactionTab = () => {
    switch (activeTab) {
      case 'bridgeIn': return 'DepositRecorded';
      case 'bridgeOut': return 'WithdrawalInitiated';
      case 'bridgeMint': return 'USDSTDeposit';
      case 'bridgeBurn': return 'RedemptionInitiated';
      default: return 'DepositRecorded';
    }
  };

  const tabConfig = getTabConfig();
  const showTabs = tabConfig.length > 1;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Bridge Assets</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-2"
          onClick={() => {
            setTargetTransactionTab(getTargetTransactionTab());
            navigate("/dashboard/bridge-transactions");
          }}
        >
          <History className="h-4 w-4" />
          View Transactions
        </Button>
      </div>
      
      {showTabs ? (
        <div className="w-full bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm">
          <Tabs
            activeKey={activeTab}
            items={tabConfig}
            onChange={(value) => setActiveTab(value)}
            className="custom-tabs"
            style={{
              '--ant-primary-color': '#3b82f6',
              '--ant-primary-color-hover': '#2563eb',
            } as React.CSSProperties}
          />
          <div className="bg-white rounded-xl p-4 shadow-sm mt-4">
            <BridgeOperation operation={getBridgeOperation()} />
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <BridgeOperation operation={getBridgeOperation()} />
        </div>
      )}
    </div>
  );
};

export default BridgeWidget; 