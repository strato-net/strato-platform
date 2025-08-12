import React, { useState, useEffect } from 'react';
import { Tabs } from 'antd';
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";
import BridgeIn from './BridgeIn';
import BridgeOut from './BridgeOut';
import { useBridgeContext } from '@/context/BridgeContext';

const BridgeWidget = () => {
  const [activeTab, setActiveTab] = useState('bridgeIn');
  const { config, fetchBridgeConfig } = useBridgeContext();
  const navigate = useNavigate();
  
  useEffect(() => {
    // Fetch bridge config on component mount
    fetchBridgeConfig().catch((error) => {
      console.error('Failed to fetch bridge config:', error);
    });
  }, [fetchBridgeConfig]);

  const showTestnet = config?.showTestnet ?? false;

  return (
    <div className="w-full space-y-6">
      <div className="bg-white shadow-md rounded-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Bridge your digital assets</h2>
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
            onClick={() => navigate("/dashboard/bridge-transactions")}
          >
            <History className="h-4 w-4" />
            View Transactions
          </Button>
        </div>
        
        <div className="space-y-4">
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
          <div className="pt-4">
            {activeTab === 'bridgeIn' ? (
              <BridgeIn showTestnet={showTestnet} />
            ) : (
              <BridgeOut showTestnet={showTestnet} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BridgeWidget; 