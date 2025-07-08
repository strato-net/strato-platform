import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeftRight,
  History,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import { Tabs } from 'antd';
import 'antd/dist/reset.css';
import './BridgePage.css';
import BridgeIn from '@/components/bridge/BridgeIn';
import BridgeOut from '@/components/bridge/BridgeOut';
import { useChainId } from 'wagmi';

const BridgePage = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('bridgeIn');
  const chainId = useChainId();
  
  // Auto-detect testnet based on connected network or environment variable
  const showTestnet = import.meta.env.VITE_SHOW_TESTNET === "true" || chainId === 11155111; // Sepolia

  return (
    <div className="flex h-screen bg-gray-50">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col ml-64">
        <DashboardHeader title="Bridge" />
        <div className="flex-1 p-8">
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="h-6 w-6 text-blue-600" />
                  <h1 className="text-2xl font-semibold text-gray-900">
                    Bridge Assets
                  </h1>
                </div>
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

              <div className="grid gap-6">
                <div className="w-[400px] bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm">
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
                </div>

                <div className="bg-white rounded-xl p-6 shadow-sm">
                  {activeTab === 'bridgeIn' ? (
                    <BridgeIn 
                      showTestnet={showTestnet}
                    />
                  ) : (
                    <BridgeOut 
                      showTestnet={showTestnet}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BridgePage;
