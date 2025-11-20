import { useEffect, useState } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs as AntdTabs } from 'antd';
import CDPBorrowWidget from '@/components/cdp/MintWidget';
import VaultsList from '@/components/cdp/VaultsList';
import LiquidationsView from '@/components/cdp/LiquidationsView';
import BadDebtView from '@/components/cdp/BadDebtView';
import { useCDP } from '@/context/CDPContext';

const CDPVaults = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [cdpActiveTab, setCdpActiveTab] = useState('vaults');
  const [vaultsRefreshTrigger, setVaultsRefreshTrigger] = useState(0);

  const { refreshVaults } = useCDP();

  useEffect(() => {
    document.title = "CDP Vaults | STRATO Mercata";
  }, []);

  const handleCDPBorrowSuccess = () => {
    setVaultsRefreshTrigger(prev => prev + 1);
  };

  const handleVaultActionSuccess = () => {
    refreshVaults();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="CDP Vaults" onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="p-6">
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

          <div className="w-full bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm mb-6">
            <AntdTabs
              activeKey={cdpActiveTab}
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
              onChange={(value) => setCdpActiveTab(value)}
              className="custom-tabs"
              style={{
                '--ant-primary-color': '#3b82f6',
                '--ant-primary-color-hover': '#2563eb',
              } as React.CSSProperties}
            />
          </div>

          {cdpActiveTab === 'vaults' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column - CDP Borrow Widget */}
              <Card>
                <CardHeader>
                  <CardTitle>Create Vault</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
                    <CDPBorrowWidget onSuccess={handleCDPBorrowSuccess} />
                  </div>
                </CardContent>
              </Card>

              {/* Right Column - Your Vaults */}
              <Card>
                <CardHeader>
                  <CardTitle>Your Vaults</CardTitle>
                </CardHeader>
                <CardContent>
                  <VaultsList
                    refreshTrigger={vaultsRefreshTrigger}
                    onVaultActionSuccess={handleVaultActionSuccess}
                  />
                </CardContent>
              </Card>
            </div>
          ) : cdpActiveTab === 'bad-debt' ? (
            <Card>
              <CardHeader>
                <CardTitle>Bad Debt</CardTitle>
              </CardHeader>
              <CardContent>
                <BadDebtView />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Liquidations</CardTitle>
              </CardHeader>
              <CardContent>
                <LiquidationsView />
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
};

export default CDPVaults;
