import React, { useState, useEffect } from 'react';
import { Tabs } from 'antd';
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBridgeContext } from "@/context/BridgeContext";
import UnifiedBridgeIn from './UnifiedBridgeIn';
import UnifiedBridgeOut from './UnifiedBridgeOut';
import { BridgeTransactionTab } from '@mercata/shared-types';

const BridgeWidget = () => {
  const [activeTab, setActiveTab] = useState('bridgeIn');
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

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Bridge</h2>
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-2"
          onClick={() => {
            // Set the target tab based on the current active tab
            const targetTab: BridgeTransactionTab = activeTab === 'bridgeIn' ? 'DepositRecorded' : 'WithdrawalInitiated';
            setTargetTransactionTab(targetTab);
            navigate("/dashboard/bridge-transactions");
          }}
        >
          <History className="h-4 w-4" />
          View Transactions
        </Button>
      </div>
      <div className="w-full bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm">
        <Tabs
          activeKey={activeTab}
          items={[
            {
              key: 'bridgeIn',
              label: 'Bridge In',
            },
            {
              key: 'bridgeOut',
              label: 'Bridge Out',
            },
          ]}
          onChange={(value) => setActiveTab(value)}
          className="custom-tabs"
          style={{
            '--ant-primary-color': '#3b82f6',
            '--ant-primary-color-hover': '#2563eb',
          } as React.CSSProperties}
        />
        <div className="bg-white rounded-xl p-4 shadow-sm mt-4">
          {activeTab === 'bridgeIn' ? (
            <UnifiedBridgeIn />
          ) : (
            <UnifiedBridgeOut />
          )}
        </div>
      </div>
    </div>
  );
};

export default BridgeWidget; 