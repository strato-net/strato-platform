import { useEffect, useState } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
import { 
  Card, 
  CardContent,  
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Tabs as AntdTabs } from 'antd';
import BridgeOut from '@/components/bridge/BridgeOut';
import WithdrawTransactionDetails from '@/components/dashboard/WithdrawTransactionDetails';
import { useSearchParams } from 'react-router-dom';
import { useBridgeContext } from '@/context/BridgeContext';
import { Loader2 } from 'lucide-react';

const WithdrawalsPage = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'from-savings' | 'bridge-out'>('from-savings');
  const [searchParams] = useSearchParams();
  const { loadNetworksAndTokens } = useBridgeContext();

  const [loadingWithdrawalMetrics] = useState(false);
  const [pendingWithdrawalsCount] = useState<number>(3);
  const [totalWithdrawn30d] = useState<string>("12,450.50");
  const [availableToWithdraw] = useState<string>("8,234.75");

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'bridge-out') {
      setActiveTab('bridge-out');
    }
  }, [searchParams]);

  useEffect(() => {
    loadNetworksAndTokens().catch(() => {});
  }, [loadNetworksAndTokens]);

  const pendingWithdrawals = pendingWithdrawalsCount.toString();

  return (
    <div className="h-screen bg-gray-50 overflow-hidden">
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

      <DashboardSidebar />

      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />

      <div className="h-screen flex flex-col transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Withdrawals" onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="flex-1 p-6 overflow-y-auto">
          <div className="mb-8 flex flex-col lg:flex-row gap-6 items-start">
            <div className="w-full lg:w-[60%] lg:min-w-[500px]">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Withdraw Assets</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="w-full bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm">
                    <AntdTabs
                      activeKey={activeTab}
                      items={[
                        {
                          key: 'from-savings',
                          label: 'From Savings',
                        },
                        {
                          key: 'bridge-out',
                          label: 'Bridge Out',
                        },
                      ]}
                      onChange={(value) => setActiveTab(value as 'from-savings' | 'bridge-out')}
                      className="custom-tabs"
                      style={{
                        '--ant-primary-color': '#3b82f6',
                        '--ant-primary-color-hover': '#2563eb',
                      } as React.CSSProperties}
                    />
                    <div className="bg-white rounded-xl p-4 shadow-sm mt-4">
                      <BridgeOut isConvert={activeTab === 'from-savings'} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="w-full lg:w-[40%] lg:min-w-[300px] lg:max-w-[400px] space-y-6">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Withdrawal Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Total Withdrawn (30d)</span>
                    {loadingWithdrawalMetrics ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : (
                      <span className="text-sm font-semibold">${totalWithdrawn30d}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Pending Withdrawals</span>
                    {loadingWithdrawalMetrics ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : (
                      <span className="text-sm font-semibold">{pendingWithdrawals}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Available to Withdraw</span>
                    {loadingWithdrawalMetrics ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : (
                      <span className="text-sm font-semibold text-green-600">${parseFloat(availableToWithdraw.replace(/,/g, '')).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Important Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-gray-600 list-disc list-inside">
                    <li>Minimum withdrawal: $10</li>
                    <li>Withdrawals are processed within 1-3 business days</li>
                    <li>Network fees vary based on blockchain congestion</li>
                    <li>Double-check withdrawal address before confirming</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Withdrawal History</CardTitle>
            </CardHeader>
            <CardContent>
              <WithdrawTransactionDetails context="withdrawals" />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default WithdrawalsPage;

