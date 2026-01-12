import { useEffect, useState, useRef } from "react";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import BridgeOut from "@/components/bridge/BridgeOut";
import WithdrawTransactionDetails from "@/components/dashboard/WithdrawTransactionDetails";
import { useSearchParams, Link } from "react-router-dom";
import { useBridgeContext } from "@/context/BridgeContext";
import { Loader2, ArrowRight, ExternalLink } from "lucide-react";
import { formatBalance } from "@/utils/numberUtils";

const WithdrawalsPage = () => {
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
      <DashboardSidebar />
      <MobileBottomNav />

      <div
        className="h-screen flex flex-col transition-all duration-300 md:pl-64"
        style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
      >
        <DashboardHeader title="Withdrawals" />

        <main className="flex-1 p-3 md:p-6 pb-20 md:pb-6 overflow-y-auto">
          <div className="mb-4 md:mb-8 flex flex-col lg:flex-row gap-4 md:gap-6 items-stretch">
            <div className="w-full lg:w-[50%] flex">
              <Card className="shadow-sm flex-1 flex flex-col rounded-xl">
                <CardContent className="flex-1 flex flex-col min-h-0 px-3 md:px-6 pt-4 md:pt-6">
                  {/* Underline Tabs - same style as DepositsPage */}
                  <div className="flex border-b border-border mb-4 md:mb-6">
                    <button
                      onClick={() => setActiveTab("from-savings")}
                      className={`flex-1 py-2.5 px-4 text-sm font-medium transition-colors border-b-2 ${
                        activeTab === "from-savings"
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      From Savings
                    </button>
                    <button
                      onClick={() => setActiveTab("bridge-out")}
                      className={`flex-1 py-2.5 px-4 text-sm font-medium transition-colors border-b-2 ${
                        activeTab === "bridge-out"
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Bridge Out
                    </button>
                  </div>

                  {/* Title with View Transactions link */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-base md:text-lg font-bold text-foreground">
                        {activeTab === "from-savings" ? "Redeem to Stablecoins" : "Bridge Out Crypto"}
                      </h3>
                      <p className="text-xs md:text-sm text-muted-foreground">
                        {activeTab === "from-savings" 
                          ? "Redeem USDST back to external stablecoins" 
                          : "Bridge assets to external networks"}
                      </p>
                    </div>
                    <Link
                      to="/bridge-transactions"
                      onClick={() => setTargetTransactionTab('WithdrawalInitiated')}
                      className="flex items-center gap-1 text-[10px] md:text-xs font-medium text-primary hover:text-primary/80 transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>View Transactions</span>
                      <ExternalLink size={10} className="md:w-3 md:h-3 shrink-0" />
                    </Link>
                  </div>

                  <div className="flex-1 min-h-0 overflow-auto">
                    <BridgeOut isSaving={activeTab === "from-savings"} />
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
            <CardHeader className="px-3 md:px-6">
              <CardTitle>Withdrawal History</CardTitle>
            </CardHeader>
            <CardContent className="px-0 md:px-6 pb-0 md:pb-6">
              <WithdrawTransactionDetails context="withdrawals" />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default WithdrawalsPage;
