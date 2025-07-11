import { useEffect, useState } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import AssetSummary from "../components/dashboard/AssetSummary";
import AssetsList from "../components/dashboard/AssetsList";
import DashboardFAQ from "../components/dashboard/DashboardFAQ";
import BorrowingSection from "../components/dashboard/BorrowingSection";
import { Wallet, Coins, Shield } from "lucide-react";
import { useUserTokens } from "@/context/UserTokensContext";
import { useUser } from "@/context/UserContext";
import { useLendingMetrics } from "@/hooks/useLendingMetrics";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { formatUnits } from "viem";
import MyPoolParticipationSection from "@/components/dashboard/MyPoolParticipationSection";
import { useLendingContext } from "@/context/LendingContext";
import { useSwapContext } from "@/context/SwapContext";

const Dashboard = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { activeTokens: tokens, inactiveTokens, loading, fetchTokens } = useUserTokens();
  const { 
    availableBorrowingPower, 
    currentBorrowed, 
    averageInterestRate, 
  } = useLendingMetrics();
  const { loans } = useLendingContext();
  const [totalBalance, setTotalBalance] = useState<number>(0)
  const [cataBalance, setCataBalance] = useState<number>(0);
  const { loadingLiquidity, liquidityInfo, refreshLoans } = useLendingContext();
  const { loading: loadingLpTokens, lpTokens, fetchLpTokensPositions } = useSwapContext();

  useEffect(() => {
    document.title = "Dashboard | STRATO Mercata";
    setTimeout(() => {
      fetchTokens();
    }, 500);
    refreshLoans();
    fetchLpTokensPositions();
  }, [userAddress]);

  useEffect(() => {
    if (!searchParams) return;
    const successParam = searchParams.get("success");

    if (successParam !== "false" && successParam !== "true") return;

    if (successParam === "true") {
      toast?.({
        title: "Purchase Successful",
        description: "Your purchase was completed successfully.",
      });
      navigate("/dashboard", { replace: true });
    }
  }, [searchParams]);

  useEffect(() => {
    if (!tokens || tokens.length === 0) return;

    let total = 0;
    let cataTotal = 0;

    for (let i = 0; i < tokens.length; i++) {

      const token = tokens[i];
      const rawPrice = token?.price || "0";
      const rawBalance = token?.balance || "0";
      const rawCollateralBalance = token?.collateralBalance || "0";

      const price = parseFloat(formatUnits(BigInt(rawPrice), 18));
      const balance = parseFloat(formatUnits(BigInt(rawBalance), 18));
      const collateralBalance = parseFloat(formatUnits(BigInt(rawCollateralBalance), 18));
      const name = token?._name || "";
      const symbol = token?._symbol || "";

      // Calculate total value including both balance and collateral
      const totalTokenValue = (balance + collateralBalance) * price;
      total += totalTokenValue;

      if (name.toLowerCase().includes("cata") || symbol.toLowerCase().includes("cata")) {
        cataTotal += totalTokenValue;
      }
    }

    // Get USDST borrowed from loans data
    const usdstBorrowed = (loans as any)?.totalAmountOwed 
      ? parseFloat(formatUnits(BigInt((loans as any).totalAmountOwed), 18))
      : 0;

    // Net Balance = All deposits (including supplied) - USDST Borrowed
    const netBalance = total - usdstBorrowed;
    setTotalBalance(netBalance);
    setCataBalance(cataTotal);
  }, [tokens, loans]);

  function formatBalance(value: number): string {
    if (typeof value !== "number" || isNaN(value) || !isFinite(value)) return "0.00";

    return value.toLocaleString("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />

      <div className="flex-1 ml-64">
        <DashboardHeader title="Overview" />

        <main className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            <AssetSummary
              title="Net Balance"
              value={formatBalance(totalBalance)}
              icon={<Wallet className="text-white" size={18} />}
              color="bg-blue-500"
            />

            <AssetSummary
              title="CATA Rewards"
              value={formatBalance(cataBalance)}
              icon={<Coins className="text-white" size={18} />}
              color="bg-purple-500"
            />

            <AssetSummary
              title="Borrowed"
              value={(loans as any)?.totalAmountOwed 
                ? `$${parseFloat(formatUnits(BigInt((loans as any).totalAmountOwed), 18)).toFixed(2)}`
                : "$0.00"
              }
              icon={<Shield className="text-white" size={18} />}
              color="bg-orange-500"
            />
          </div>

          <div className="mb-8">
            <AssetsList loading={loading} tokens={tokens} inActiveTokens={inactiveTokens} />
          </div>

          <div className="mb-8">
            <BorrowingSection 
              availableBorrowingPower={availableBorrowingPower}
              currentBorrowed={currentBorrowed}
              averageInterestRate={averageInterestRate}
            />
          </div>

          <div className="mb-8">
            <MyPoolParticipationSection loadingLpTokens={loadingLpTokens} loadingLiquidity={loadingLiquidity} liquidityInfo={liquidityInfo} lpTokens={lpTokens} /> 
          </div>

          <div className="mb-8">
            <DashboardFAQ />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;

