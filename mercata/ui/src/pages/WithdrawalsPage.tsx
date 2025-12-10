import { useEffect, useState, useRef } from "react";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs as AntdTabs } from "antd";
import BridgeOut from "@/components/bridge/BridgeOut";
import WithdrawTransactionDetails from "@/components/dashboard/WithdrawTransactionDetails";
import { useSearchParams, Link } from "react-router-dom";
import { useBridgeContext } from "@/context/BridgeContext";
import { Loader2, ArrowRight } from "lucide-react";
import { formatBalance } from "@/utils/numberUtils";

const WithdrawalsPage = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"from-savings" | "bridge-out">(
    "from-savings"
  );
  const [searchParams] = useSearchParams();
  const { loadNetworksAndTokens, withdrawalSummary, loadingWithdrawalSummary, fetchWithdrawalSummary, setTargetTransactionTab } =
    useBridgeContext();

  const withdrawalSummaryIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "bridge-out") {
      setActiveTab("bridge-out");
    }
  }, [searchParams]);

  useEffect(() => {
    loadNetworksAndTokens().catch((error) => {
      console.error('Failed to load networks and tokens:', error);
    });
  }, [loadNetworksAndTokens]);

  // Withdrawal summary polling (15s interval)
  useEffect(() => {
    const hasExistingData = !!withdrawalSummary;
    fetchWithdrawalSummary(!hasExistingData);

    withdrawalSummaryIntervalRef.current = setInterval(() => {
      fetchWithdrawalSummary(false);
    }, 15000);

    return () => {
      if (withdrawalSummaryIntervalRef.current) {
        clearInterval(withdrawalSummaryIntervalRef.current);
        withdrawalSummaryIntervalRef.current = null;
      }
    };
  }, [fetchWithdrawalSummary]);

  return (
    <div className="h-screen bg-background overflow-hidden">
      <style>{`
        .custom-tabs .ant-tabs-tab {
          justify-content: center !important;
        }
        .custom-tabs .ant-tabs-tab-btn {
          justify-content: center !important;
          text-align: center !important;
          width: 100% !important;
          color: hsl(var(--muted-foreground)) !important;
        }
        .custom-tabs .ant-tabs-tab-active .ant-tabs-tab-btn {
          color: hsl(var(--primary)) !important;
          text-shadow: none !important;
        }
        .custom-tabs .ant-tabs-ink-bar {
          background: hsl(var(--primary)) !important;
        }
      `}</style>

      <DashboardSidebar />

      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />

      <div
        className="h-screen flex flex-col transition-all duration-300 md:pl-64"
        style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
      >
        <DashboardHeader
          title="Withdrawals"
          onMenuClick={() => setIsMobileSidebarOpen(true)}
        />

        <main className="flex-1 p-6 overflow-y-auto">
          <div className="mb-8 flex flex-col lg:flex-row gap-6 items-stretch">
            <div className="w-full lg:w-[50%] flex">
              <Card className="shadow-sm flex-1 flex flex-col">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Withdraw Assets</CardTitle>
                    <Link
                      to="/bridge-transactions"
                      onClick={() => setTargetTransactionTab('WithdrawalInitiated')}
                      className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      <ArrowRight size={16} />
                      View Transactions
                    </Link>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col min-h-0">
                  <div className="w-full flex-1 flex flex-col min-h-0">
                    <AntdTabs
                      activeKey={activeTab}
                      items={[
                        {
                          key: "from-savings",
                          label: "From Savings",
                        },
                        {
                          key: "bridge-out",
                          label: "Bridge Out",
                        },
                      ]}
                      onChange={(value) =>
                        setActiveTab(value as "from-savings" | "bridge-out")
                      }
                      className="custom-tabs"
                      style={
                        {
                          "--ant-primary-color": "hsl(var(--primary))",
                          "--ant-primary-color-hover": "hsl(var(--primary))",
                        } as React.CSSProperties
                      }
                    />
                    <div className="mt-4 flex-1 min-h-0 overflow-auto">
                      <BridgeOut isConvert={activeTab === "from-savings"} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="w-full lg:w-[50%] flex flex-col gap-6">
              <Card className="shadow-sm flex flex-col">
                <CardHeader>
                  <CardTitle>Withdrawal Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Total Withdrawn (30d)
                    </span>
                    {loadingWithdrawalSummary ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="text-sm font-semibold">
                        {formatBalance(
                          withdrawalSummary?.totalWithdrawn30d || "0",
                          undefined,
                          18,
                          2,
                          2,
                          true
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Pending Withdrawals
                    </span>
                    {loadingWithdrawalSummary ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="text-sm font-semibold">
                        {formatBalance(
                          withdrawalSummary?.pendingWithdrawals || "0",
                          undefined,
                          18,
                          2,
                          2,
                          true
                        )}
                      </span>
                    )}
                  </div>
                  
                </CardContent>
              </Card>

              <Card className="shadow-sm flex flex-col">
                <CardHeader>
                  <CardTitle>Important Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
                    <li>Withdrawals are processed within 1-3 business days</li>
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
