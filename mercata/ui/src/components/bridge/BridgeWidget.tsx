import React, { useState, useEffect } from 'react';
import { Tabs } from 'antd';
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBridgeContext } from "@/context/BridgeContext";
import BridgeIn from './BridgeIn';
import BridgeOut from './BridgeOut';

const BridgeWidget = () => {
  const [activeTab, setActiveTab] = useState('bridgeIn');
  const [showTestnet, setShowTestnet] = useState(false);
  const [chainId, setChainId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { getNetworkConfig } = useBridgeContext();

  // Fetch network configuration on component mount
  useEffect(() => {
    const fetchNetworkConfig = async () => {
      try {
        setLoading(true);
        const networkConfig = await getNetworkConfig();
        
        console.log('Raw network config response:', networkConfig);
        
        // Extract chainId from the first chain in the response
        if (networkConfig && networkConfig.length > 0) {
          const firstChain = networkConfig[0];
          const extractedChainId = firstChain.chainId;
          setChainId(extractedChainId);
          console.log(`Successfully extracted chain ID: ${extractedChainId}`);
        } else {
          console.log('No chains found in network config');
          setChainId(null);
        }
      } catch (error) {
        console.error('Error fetching network config:', error);
        setChainId(null);
      } finally {
        setLoading(false);
      }
    };

    fetchNetworkConfig();
  }, [getNetworkConfig]);

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
            <BridgeIn showTestnet={showTestnet} networkChainId={chainId} />
          ) : (
            <BridgeOut showTestnet={showTestnet} networkChainId={chainId} />
          )}
        </div>
      </div>
    </div>
  );
};

export default BridgeWidget; 