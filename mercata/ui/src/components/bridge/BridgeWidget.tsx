import React, { useState, useEffect } from 'react';
import { Tabs } from 'antd';
import BridgeIn from './BridgeIn';
import BridgeOut from './BridgeOut';
import { useBridgeContext } from '@/context/BridgeContext';

const BridgeWidget = () => {
  const [activeTab, setActiveTab] = useState('bridgeIn');
  const { config, fetchBridgeConfig } = useBridgeContext();
  
  useEffect(() => {
    // Fetch bridge config on component mount
    fetchBridgeConfig().catch((error) => {
      console.error('Failed to fetch bridge config:', error);
    });
  }, [fetchBridgeConfig]);

  const showTestnet = config?.showTestnet ?? false;

  return (
    <div className="w-full">
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
  );
};

export default BridgeWidget; 