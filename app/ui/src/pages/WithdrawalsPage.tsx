import { usePageTitle } from "@/hooks/usePageTitle";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import WithdrawalWidget from "@/components/router/WithdrawalWidget";
import RecentTransactions from "@/components/bridge/RecentTransactions";
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { useFeeBalancesReady, useTradeBridgeCatalog } from "@/hooks/trade/useTradeTokens";

const WithdrawalsPage = () => {
  usePageTitle("Bridge Out");

  const { isLoggedIn, userAddress } = useUser();
  const bridgeCatalog = useTradeBridgeCatalog();
  const feeBalancesReady = useFeeBalancesReady();

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
                  <CardTitle className="text-base md:text-xl">Bridge Out</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col min-h-0">
                  <div className="w-full flex-1 min-h-0 overflow-auto p-1 -m-1">
                    <WithdrawalWidget catalog={bridgeCatalog} active feeBalancesReady={feeBalancesReady}
                      onPendingChange={() => {}} />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="w-full lg:w-[50%] flex flex-col gap-6">
              <Card className="shadow-sm flex flex-col">
                <CardHeader>
                  <CardTitle className="text-base md:text-xl">Important Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
                    <li>Withdrawals are not instant—funds arrive after bridge verification and confirmation on the destination network.</li>
                    <li>Large amounts may require manual approval, which extends processing time.</li>
                    <li>Double-check the receiving address—completed withdrawals cannot be reversed.</li>
                  </ul>
                </CardContent>
              </Card>

              {/* Withdrawal History */}
              {isLoggedIn && (
                <RecentTransactions key={userAddress} withdrawalsOnly
                  networkOptions={bridgeCatalog.availableNetworks} routeTokens={bridgeCatalog.bridgeableTokens} />
              )}
            </div>
          </div>

        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default WithdrawalsPage;
