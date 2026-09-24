import { useEffect, useRef } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import WithdrawalWidget from "@/components/router/WithdrawalWidget";
import WithdrawTransactionDetails from "@/components/dashboard/WithdrawTransactionDetails";
import { useBridgeContext } from "@/context/BridgeContext";
import { Loader2 } from "lucide-react";
import { formatBalance } from "@/utils/numberUtils";
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { useFeeBalancesReady, useTradeBridgeCatalog } from "@/hooks/trade/useTradeTokens";

const WithdrawalsPage = () => {
  usePageTitle("Bridge Out");

  const { isLoggedIn, loading, isAppAuthenticated, externalWalletAddress } = useUser();
  const { withdrawalSummary, loadingWithdrawalSummary, fetchWithdrawalSummary } = useBridgeContext();
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
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="Bridge Out" />

        <main className="flex-1 p-4 md:p-6">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to withdraw assets to another network" />
          )}
          <div className="mx-auto max-w-7xl space-y-6">
            <p className="text-muted-foreground">Move assets from STRATO back to another network. Withdrawals are verified on both chains before funds arrive.</p>

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)]">
              <div>
                <WithdrawalWidget catalog={bridgeCatalog} active feeBalancesReady={feeBalancesReady}
                  onPendingChange={() => {}} onSubmitted={() => fetchWithdrawalSummary(false)} />
              </div>

              <div className="space-y-6">
                <Card className="shadow-sm">
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

                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle>Good to know</CardTitle>
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
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default WithdrawalsPage;
