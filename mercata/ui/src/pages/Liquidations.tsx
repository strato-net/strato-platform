import React, { useEffect } from "react";
import { useUser } from "@/context/UserContext";
import { useLiquidationContext } from "@/context/LiquidationContext";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import LiquidationsSection from "../components/dashboard/LiquidationsSection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

const Liquidations = () => {
  const { userAddress } = useUser();
  const { liquidatable, watchlist, loading, error, refreshData } = useLiquidationContext();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = React.useState(false);

  useEffect(() => {
    document.title = "Liquidations | STRATO Mercata";
  }, []);

  // Check if user's own loan is in liquidations
  const userLoanInLiquidations = liquidatable.find(
    loan => loan.user.toLowerCase() === userAddress?.toLowerCase()
  );

  const userLoanInWatchlist = watchlist.find(
    loan => loan.user.toLowerCase() === userAddress?.toLowerCase()
  );

   const hasUserRisk = userLoanInLiquidations || userLoanInWatchlist;


  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Liquidations" onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="p-6">
          {/* User Risk Alert */}
          {hasUserRisk && (
            <Card className="mb-6 border-red-200 bg-red-50">
              <CardHeader className="pb-3">
                <CardTitle className="text-red-800 flex items-center gap-2">
                  <Info className="h-5 w-5" />
                  Your Loan is at Risk
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Alert className="border-red-200 bg-red-100">
                  <AlertDescription className="text-red-800">
                    {userLoanInLiquidations 
                      ? "Your loan is currently liquidatable. Take immediate action to prevent liquidation."
                      : "Your loan is approaching liquidation threshold. Consider adding collateral or repaying debt."
                    }
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          )}

          {/* Liquidations Section */}
          <LiquidationsSection />
        </main>
      </div>
    </div>
  );
};

export default Liquidations;
