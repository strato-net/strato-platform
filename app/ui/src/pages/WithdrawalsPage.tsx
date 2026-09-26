import { useEffect, useRef } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import WithdrawalWidget from "@/components/router/WithdrawalWidget";
import WithdrawTransactionDetails from "@/components/dashboard/WithdrawTransactionDetails";
import { Link } from "react-router-dom";
import { useBridgeContext } from "@/context/BridgeContext";
import { Loader2, ArrowRight } from "lucide-react";
import { formatBalance } from "@/utils/numberUtils";
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { requestWalletConnection } from "@/lib/auth";
import { useFeeBalancesReady, useTradeBridgeCatalog } from "@/hooks/trade/useTradeTokens";

const WithdrawalsPage = () => {
  usePageTitle("Bridge Out");

  const { isLoggedIn, loading, isAppAuthenticated, externalWalletAddress } = useUser();
  const { withdrawalSummary, loadingWithdrawalSummary, fetchWithdrawalSummary, setTargetTransactionTab } =
    useBridgeContext();
  const bridgeCatalog = useTradeBridgeCatalog();
  const feeBalancesReady = useFeeBalancesReady();

  const withdrawalSummaryIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const canLoadWithdrawData = !loading && (isAppAuthenticated || !!externalWalletAddress);

  // Withdrawal summary polling (15s interval)
  useEffect(() => {
    if (!canLoadWithdrawData) return;

    fetchWithdrawalSummary(true);

    withdrawalSummaryIntervalRef.current = setInterval(() => {
      fetchWithdrawalSummary(false);
    }, 15000);

    return () => {
      if (withdrawalSummaryIntervalRef.current) {
        clearInterval(withdrawalSummaryIntervalRef.current);
        withdrawalSummaryIntervalRef.current = null;
      }
    };
  }, [canLoadWithdrawData, fetchWithdrawalSummary]);

  const summaryRows: Array<[string, string | undefined]> = [
    ["Total Bridged Out (30d)", withdrawalSummary?.totalWithdrawn30d],
    ["Pending Bridge Outs", withdrawalSummary?.pendingWithdrawals],
  ];

  return (
    <div className="h-screen bg-background overflow-hidden pb-16 md:pb-0">
      <DashboardSidebar />

      <div
        className="h-screen flex flex-col transition-all duration-300"
        style={{ paddingLeft: "var(--sidebar-width, 0px)" }}
      >
        <DashboardHeader title="Bridge Out" />

        <main className="flex-1 p-4 md:p-6 pb-10 md:pb-6 overflow-y-auto">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to withdraw assets and bridge tokens" />
          )}
          <div className="mb-8 flex flex-col lg:flex-row gap-6 items-stretch">
            <div className="w-full lg:w-[50%] flex">
              <Card className="shadow-sm flex-1 flex flex-col">
                <CardHeader className="pb-2 md:pb-4">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base md:text-xl">Bridge Out</CardTitle>
                    <Link
                      to="/bridge-transactions?from=withdrawals"
                      onClick={(e) => {
                        if (!isLoggedIn) {
                          e.preventDefault();
                          requestWalletConnection();
                          return;
                        }
                        setTargetTransactionTab('WithdrawalInitiated');
                      }}
                      className={`flex items-center gap-1 text-xs md:text-sm font-semibold transition-colors whitespace-nowrap ${isLoggedIn
                          ? "text-blue-600 hover:text-blue-800 cursor-pointer"
                          : "text-muted-foreground hover:text-foreground cursor-pointer"
                        }`}
                    >
                      <ArrowRight size={14} className="md:w-4 md:h-4" />
                      View Transactions
                    </Link>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col min-h-0">
                  <div className="w-full flex-1 min-h-0 overflow-auto p-1 -m-1">
                    <WithdrawalWidget catalog={bridgeCatalog} active feeBalancesReady={feeBalancesReady}
                      onPendingChange={() => {}} onSubmitted={() => fetchWithdrawalSummary(false)} />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="w-full lg:w-[50%] flex flex-col gap-6">
              <Card className="shadow-sm flex flex-col">
                <CardHeader>
                  <CardTitle>Bridge Out Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {summaryRows.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      {loadingWithdrawalSummary ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <span className="text-sm font-semibold">
                          {formatBalance(value || "0", undefined, 18, 2, 2, true)}
                        </span>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="shadow-sm flex flex-col">
                <CardHeader>
                  <CardTitle>Important Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
                    <li>Withdrawals are not instant—funds arrive after bridge verification and confirmation on the destination network, typically within 1–3 business days.</li>
                    <li>Large amounts may require manual approval, which extends processing time.</li>
                    <li>Double-check the receiving address—completed withdrawals cannot be reversed.</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Withdrawal History - hidden on mobile and for guests */}
          {isLoggedIn && (
            <Card className="shadow-sm hidden md:block">
              <CardHeader>
                <CardTitle>Bridge Out History</CardTitle>
              </CardHeader>
              <CardContent>
                <WithdrawTransactionDetails context="withdrawals" />
              </CardContent>
            </Card>
          )}
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default WithdrawalsPage;
