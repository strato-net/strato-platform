import React, { useState, useEffect, Suspense } from 'react';
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBridgeContext } from '@/context/BridgeContext';
import { AntTabs, AntLoadingFallback } from '@/components/lazy/antd';
import { BridgeIn, BridgeOut, ModalLoadingFallback } from '@/components/lazy/components';

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
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Bridge Assets</h2>
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
        <Suspense fallback={<AntLoadingFallback />}>
          <AntTabs
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
        </Suspense>
        <div className="bg-white rounded-xl p-4 shadow-sm mt-4">
          <Suspense fallback={<ModalLoadingFallback />}>
            {activeTab === 'bridgeIn' ? (
              <BridgeIn showTestnet={showTestnet} />
            ) : (
              <BridgeOut showTestnet={showTestnet} />
            )}
          </Suspense>
        </div>
      </div>
    </div>
  );
};

export default BridgeWidget; 