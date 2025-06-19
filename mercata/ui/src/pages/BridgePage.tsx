import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeftRight,
  History,
  Copy,
} from "lucide-react";
import {
  useAccount,
  useDisconnect,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useNavigate } from "react-router-dom";
import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs } from 'antd';
import 'antd/dist/reset.css';
import './BridgePage.css';
import BridgeIn from '@/components/bridge/BridgeIn';
import BridgeOut from '@/components/bridge/BridgeOut';

const BridgePage = () => {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('bridgeIn');
  const [showTestnet] = useState(import.meta.env.VITE_SHOW_TESTNET === "true");

  const copyToClipboard = async () => {
    if (address) {
      await navigator.clipboard.writeText(address);
      toast({
        title: "Address copied!",
        description: "Wallet address copied to clipboard",
        duration: 2000,
      });
    }
  };

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
                <div className="flex items-center gap-3">
                  {isConnected ? (
                    <>
                      <div
                        onClick={() => disconnect()}
                        className="relative group cursor-pointer"
                      >
                        <div className="px-4 py-2 bg-green-50 text-green-600 rounded-xl font-semibold group-hover:opacity-0 transition-opacity">
                          Wallet Connected
                        </div>
                        <div className="absolute inset-0 bg-red-50 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-red-600 font-semibold">
                            Disconnect
                          </span>
                        </div>
                      </div>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2 text-xs bg-green-100/50 px-2 py-1 rounded-md font-mono text-green-700 cursor-pointer">
                              {address?.slice(0, 6)}...{address?.slice(-4)}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard();
                                }}
                                className="hover:text-green-900 transition-colors cursor-pointer"
                              >
                                <Copy size={12} />
                              </button>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{address}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </>
                  ) : (
                    <div className="[&>button]:bg-gradient-to-r [&>button]:from-[#1f1f5f] [&>button]:via-[#293b7d] [&>button]:to-[#16737d] [&>button]:text-white [&>button]:px-4 [&>button]:py-2 [&>button]:rounded-xl [&>button]:font-semibold [&>button]:hover:opacity-90 [&>button]:transition-all">
                      <ConnectButton label={"Connect Wallet"} />
                    </div>
                  )}
                </div>

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
